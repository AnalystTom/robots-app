import { homedir } from "node:os";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  SecretStore,
  TerminalRequest,
  WorkspaceDirectoryRequest,
  WorkspaceExportLimits,
} from "@robots/adapter-kit";
import type { PrismaClient } from "@robots/db";
import { draftRecordingsOfLease, runAsSystem } from "@robots/db";
import { getLogger } from "@robots/logging";
import { cancelComputerRunWork, providerKeepsHome } from "./computer-idle.js";
import { computerProviderDescriptor } from "./computer-provider-registry.js";
import { manageComputerWorkspaceDirectories } from "./computer-workspace.js";
import {
  ConfiguredSandbox,
  loadComputerOwnerSettings,
  loadComputerProviderSelection,
} from "./configured-sandbox.js";
import { assertHostCommandsAllowed, DesktopSandboxProvider } from "./desktop-sandbox.js";
import { hostComputerGate } from "./host-computer-access.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import type { SandboxProviderOptions } from "./sandbox-factory.js";
import { createSandboxProvider } from "./sandbox-factory.js";

export function sandboxKindForBot(envKind: string, computerHost: string | null | undefined) {
  if (envKind === "docker" && computerHost === "this-mac") return "desktop";
  return envKind;
}

export async function createRunSandbox(
  kind: string,
  opts: SandboxProviderOptions & {
    prisma?: PrismaClient;
    secrets?: Pick<SecretStore, "load" | "onChange">;
  },
): Promise<SandboxProvider> {
  const base = await createBaseRunSandbox(kind, opts);
  if (!opts.prisma || !opts.secrets || kind === "desktop" || kind === "fake") return base;
  const { prisma, secrets } = opts;
  const configured = new ConfiguredSandbox(
    base,
    () => loadComputerProviderSelection(prisma, secrets, true),
    {
      onSecretChange: secrets.onChange?.bind(secrets),
      loadOwn: (homeKey) => loadComputerOwnerSettings(prisma, secrets, homeKey, true),
      createProvider: (settings) =>
        createBaseRunSandbox(settings.provider, {
          ...opts,
          ...computerProviderDescriptor(settings.provider).verify(settings.values),
        }),
    },
  );
  await configured
    .refresh()
    .catch((error) => getLogger().warn("computer_provider.load_failed", { error }));
  return configured;
}

async function createBaseRunSandbox(
  kind: string,
  opts: SandboxProviderOptions & { prisma?: PrismaClient },
): Promise<SandboxProvider> {
  if (kind === "desktop") {
    assertHostCommandsAllowed();
    return new DesktopSandboxProvider({
      root: opts.dataDir,
      hostRoots: [homedir()],
    });
  }
  const prisma = opts.prisma;
  const primary = await createSandboxProvider(kind, {
    ...opts,
    referenceInUse: prisma
      ? async (computer) =>
          (await runAsSystem("check whether another computer shares a provider resource", () =>
            prisma.computer.count({
              where: {
                kind: computer.kind,
                providerRef: computer.providerRef,
                homeKey: { not: computer.botId },
                state: { in: ["booting", "running", "suspending"] },
              },
            }),
          )) > 0
      : opts.referenceInUse,
    onUnsafeStop: opts.prisma
      ? async (providerRef) => {
          const held = await opts.prisma!.computer.findMany({
            where: { kind, providerRef, controlLeaseId: { not: null } },
            select: { spaceId: true, controlLeaseId: true },
          });
          const quarantined = await opts.prisma!.computer.updateMany({
            where: { kind, providerRef },
            data: {
              state: "quarantined",
              screenUrl: null,
              screenGeneration: { increment: 1 },
              controlFence: { increment: 1 },
              controlHolder: "none",
              controlLeaseId: null,
              controlUserId: null,
              controlLeaseExpiresAt: null,
              controlBotId: null,
            },
          });
          if (quarantined.count === 0)
            throw new Error("Computer recovery requirement could not be recorded");
          for (const { spaceId, controlLeaseId } of held) {
            await draftRecordingsOfLease(opts.prisma!, { spaceId, leaseId: controlLeaseId! });
          }
        }
      : opts.onUnsafeStop,
  });
  if (kind !== "docker" || !opts.prisma) return primary;
  return new HostAwareSandbox(
    primary,
    new HostComputerSandbox(opts.hostComputerUrl ?? "", opts.hostComputerToken ?? ""),
    hostComputerGate(opts.prisma, opts.hostComputerAccess).forHome,
  );
}

export class HostAwareSandbox implements SandboxProvider {
  readonly pageBrowser?: SandboxProvider["pageBrowser"];

  constructor(
    private readonly isolated: SandboxProvider,
    private readonly host: SandboxProvider,
    private readonly hostEnabled: (homeKey: string | undefined) => Promise<boolean>,
  ) {
    if (isolated.pageBrowser || host.pageBrowser) {
      this.pageBrowser = async (computer, request, context) => {
        const provider = await this.usable(computer);
        return provider.pageBrowser
          ? provider.pageBrowser(computer, request, context)
          : {
              ok: false,
              uncertain: false,
              fallback: "computer_act",
              error: "Page browser is unavailable on this computer.",
            };
      };
    }
  }

  ownsReference(computer: Pick<ComputerRef, "kind" | "providerRef">) {
    return this.route(computer).ownsReference?.(computer) ?? true;
  }

  describe() {
    return this.isolated.describe();
  }

  private route(computer: Pick<ComputerRef, "kind">) {
    return computer.kind === "desktop" ? this.host : this.isolated;
  }

  private async usable(computer: Pick<ComputerRef, "kind" | "botId">) {
    if (computer.kind !== "desktop") return this.isolated;
    if (!(await this.hostEnabled(computer.botId)))
      throw new Error("Local computer access is disabled");
    return this.host;
  }

  private async provisioner(homeKey: string | undefined) {
    return (await this.hostEnabled(homeKey)) ? this.host : this.isolated;
  }

  async provisionKind(homeKey?: string) {
    return (await this.provisioner(homeKey)).describe().id as ComputerRef["kind"];
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ) {
    const provider = await this.provisioner(request.botId);
    const providerKind = provider.describe().id;
    return provider.provision(
      {
        ...request,
        providerRef: request.providerKind === providerKind ? request.providerRef : undefined,
      },
      context,
    );
  }

  async isRunning(computer: ComputerRef, context: AdapterContext): Promise<boolean> {
    const provider = await this.provisioner(computer.botId);
    if (provider.describe().id !== computer.kind) return false;
    return provider.isRunning?.(computer, context) ?? false;
  }

  async isStopped(computer: ComputerRef, context: AdapterContext): Promise<boolean> {
    return this.route(computer).isStopped?.(computer, context) ?? false;
  }

  async environment(computer: ComputerRef, context: AdapterContext) {
    return (await this.usable(computer)).environment?.(computer, context);
  }

  async prepare(computer: ComputerRef, context: AdapterContext) {
    return (await this.usable(computer)).prepare(computer, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    yield* (await this.usable(computer)).execute(computer, request, context);
  }

  async workspaceDirectories(
    computer: ComputerRef,
    request: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return manageComputerWorkspaceDirectories(
      await this.usable(computer),
      computer,
      request,
      context,
    );
  }

  cancelRunWork(computer: ComputerRef, computerId: string, runId: string, context: AdapterContext) {
    return cancelComputerRunWork(this.route(computer), computer, computerId, runId, context);
  }

  async connectScreen(computer: ComputerRef, request: ScreenRequest, context: AdapterContext) {
    return (await this.usable(computer)).connectScreen(computer, request, context);
  }

  async connectTerminal(computer: ComputerRef, request: TerminalRequest, context: AdapterContext) {
    const provider = await this.usable(computer);
    if (!provider.connectTerminal) throw new Error("terminal is unavailable on this computer");
    return provider.connectTerminal(computer, request, context);
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    return (await this.usable(computer)).sendInput(computer, input, lease, context);
  }

  async observe(computer: ComputerRef, context: AdapterContext) {
    return (await this.usable(computer)).observe(computer, context);
  }

  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return (await this.usable(computer)).act(computer, request, context);
  }

  async listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return (await this.usable(computer)).listFiles(computer, path, context);
  }

  async readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    return (await this.usable(computer)).readFile(computer, path, context, options);
  }

  async writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    return (await this.usable(computer)).writeFile(computer, file, context);
  }

  exportWorkspace(computer: ComputerRef, context: AdapterContext, limits?: WorkspaceExportLimits) {
    if (computer.kind !== "desktop")
      return this.isolated.exportWorkspace(computer, context, limits);
    return this.exportHostWorkspace(computer, context, limits);
  }

  private async *exportHostWorkspace(
    computer: ComputerRef,
    context: AdapterContext,
    limits?: WorkspaceExportLimits,
  ) {
    yield* (await this.usable(computer)).exportWorkspace(computer, context, limits);
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    return (await this.usable(computer)).importWorkspace(computer, files, context);
  }

  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).snapshot(computer, context);
  }

  billsWhileRunning(computer: Pick<ComputerRef, "kind">): boolean {
    return this.route(computer).billsWhileRunning?.(computer) ?? false;
  }

  keepsHome(computer: ComputerRef) {
    return providerKeepsHome(this.route(computer), computer);
  }

  keepAlive(computer: ComputerRef) {
    return this.route(computer).keepAlive?.(computer) ?? Promise.resolve();
  }

  releaseScreen(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).releaseScreen?.(computer, context) ?? Promise.resolve();
  }

  setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ) {
    return (
      this.route(computer).setScreenControl?.(computer, interactive, context, controlToken) ??
      Promise.resolve()
    );
  }

  stop(computer: ComputerRef, context: AdapterContext, options?: { discardUnsaved?: boolean }) {
    return this.route(computer).stop(computer, context, options);
  }

  destroy(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).destroy(computer, context);
  }
}
