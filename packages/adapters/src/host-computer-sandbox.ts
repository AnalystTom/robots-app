import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  HostBrowserImportRequest,
  HostBrowserImportResult,
  HostBrowserProfile,
  PageBrowserCommand,
  PageBrowserResult,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
  WorkspaceDirectoryRequest,
} from "@robots/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@robots/core";
import type { DesktopEnvironment } from "@robots/core/node/desktop-runtime";
import { screenSessionKey } from "./computer-screens.js";
import { describeDesktopSandbox } from "./desktop-sandbox.js";
import type {
  HostComputerEnvironment,
  HostComputerFrame,
  HostComputerRequest,
  HostDesktopRun,
} from "./host-computer-protocol.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  HOST_COMPUTER_MAX_FILE_BYTES,
  HOST_DESKTOP_MAX_RUN_MS,
  HostComputerRemoteError,
  hostComputerDeadlineMs,
} from "./host-computer-protocol.js";
import { LinuxDesktop } from "./linux-desktop.js";
import { shouldSkipPortableWorkspaceFile } from "./workspace-save-policy.js";

const NO_SCREEN = "Local screen control is unavailable. Use commands to work with files and apps.";

export class HostComputerSandbox implements SandboxProvider {
  private readonly desktop = new LinuxDesktop({
    environment: (computer, context) =>
      this.one<DesktopEnvironment>(
        { method: "desktopEnvironment", botId: computer.botId },
        context,
      ),
    run: (computer, script, context) =>
      this.desktopRun(computer, script, undefined, HOST_DESKTOP_MAX_RUN_MS, context),
    runWithInput: (computer, script, input, timeoutMs, context) =>
      this.desktopRun(computer, script, input, timeoutMs, context),
    screenUrl: async (_computer, port) => `http://${new URL(this.url).hostname}:${port}/embed.html`,
  });

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}
  describe() {
    return describeDesktopSandbox();
  }

  private async *request<T>(input: HostComputerRequest, context: AdapterContext): AsyncIterable<T> {
    if (!this.url || !this.token)
      throw new Error("Local computer access requires the desktop app. Enable it in the app menu.");
    const body = JSON.stringify({ ...input, runId: context.runId });
    if (Buffer.byteLength(body) > HOST_COMPUTER_MAX_BYTES)
      throw new Error("Local computer request is too large");
    const signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(hostComputerDeadlineMs(input)),
    ]);
    const response = await fetch(new URL("/computer", this.url), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body,
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(
        "Local computer unavailable. Open the desktop app and enable local computer access.",
      );
    }
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          signal.throwIfAborted();
          if (newline > HOST_COMPUTER_MAX_BYTES)
            throw new Error("Local computer response is too large");
          const frame = JSON.parse(pending.slice(0, newline)) as HostComputerFrame<T>;
          pending = pending.slice(newline + 1);
          if ("error" in frame) throw new HostComputerRemoteError(frame.error);
          if ("heartbeat" in frame) {
            newline = pending.indexOf("\n");
            continue;
          }
          if ("done" in frame) {
            return;
          }
          yield frame.value;
          newline = pending.indexOf("\n");
        }
        if (pending.length > HOST_COMPUTER_MAX_BYTES)
          throw new Error("Local computer response is too large");
      }
      throw new Error("Local computer disconnected. Check the result before retrying.");
    } finally {
      signal.removeEventListener("abort", abort);
      const cancellation = reader.cancel().catch(() => undefined);
      if (!signal.aborted) await cancellation;
      reader.releaseLock();
    }
  }
  stream<T>(input: HostComputerRequest, signal: AbortSignal): AsyncIterable<T> {
    return this.request<T>(input, {
      operationId: "host-computer",
      traceId: "host-computer",
      spaceId: "local",
      userId: "local",
      runId: input.runId,
      signal,
    });
  }
  private async one<T>(input: HostComputerRequest, context: AdapterContext): Promise<T> {
    let result: T | undefined;
    for await (const value of this.request<T>(input, context)) result = value;
    return result as T;
  }
  environment(computer: ComputerRef, context: AdapterContext) {
    return this.one<HostComputerEnvironment>(
      { method: "environment", botId: computer.botId },
      context,
    );
  }
  private async hasScreen(computer: ComputerRef, context: AdapterContext) {
    return (await this.environment(computer, context)).screen === true;
  }
  private async screen(computer: ComputerRef, context: AdapterContext) {
    if (!(await this.hasScreen(computer, context))) throw new Error(NO_SCREEN);
    return this.desktop;
  }
  private desktopRun(
    computer: ComputerRef,
    script: string,
    input: string | undefined,
    timeoutMs: number,
    context: AdapterContext,
  ) {
    return this.one<HostDesktopRun>(
      { method: "desktopRun", botId: computer.botId, script, input, timeoutMs },
      context,
    );
  }
  provision(input: { botId: string; homePath: string }, context: AdapterContext) {
    return this.one<ComputerRef>({ method: "provision", botId: input.botId }, context);
  }
  async prepare(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "prepare", botId: computer.botId }, context);
  }
  isRunning(computer: ComputerRef, context: AdapterContext) {
    return this.one<boolean>({ method: "isRunning", botId: computer.botId }, context);
  }
  execute(computer: ComputerRef, command: CommandRequest, context: AdapterContext) {
    return this.request<ProcessEvent>(
      {
        method: "execute",
        botId: computer.botId,
        command: { ...command, timeoutMs: boundedSandboxCommandTimeoutMs(command.timeoutMs) },
      },
      context,
    );
  }
  workspaceDirectories(
    computer: ComputerRef,
    directories: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ) {
    return this.one<string[]>(
      { method: "workspaceDirectories", botId: computer.botId, directories },
      context,
    );
  }
  async cancelRunWork(
    computer: ComputerRef,
    _computerId: string,
    runId: string,
    context: AdapterContext,
  ) {
    await this.one({ method: "cancelRunWork", botId: computer.botId, targetRunId: runId }, context);
  }
  listFiles(computer: ComputerRef, path: string, context: AdapterContext) {
    return this.one<ComputerFileEntry[]>(
      { method: "listFiles", botId: computer.botId, path },
      context,
    );
  }
  async readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    const content = await this.one<string>(
      {
        method: "readFile",
        botId: computer.botId,
        path,
        maxBytes: Math.min(
          options?.maxBytes ?? HOST_COMPUTER_MAX_FILE_BYTES,
          HOST_COMPUTER_MAX_FILE_BYTES,
        ),
      },
      context,
    );
    return new Uint8Array(Buffer.from(content, "base64"));
  }
  async writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext) {
    await this.one(
      {
        method: "writeFile",
        botId: computer.botId,
        file: { ...file, content: Buffer.from(file.content).toString("base64") },
      },
      context,
    );
  }
  async *exportWorkspace(
    computer: ComputerRef,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    for await (const file of this.request<{ path: string; content: string; executable?: boolean }>(
      { method: "exportWorkspace", botId: computer.botId },
      context,
    )) {
      if (shouldSkipPortableWorkspaceFile(file.path)) continue;
      yield { ...file, content: new Uint8Array(Buffer.from(file.content, "base64")) };
    }
  }
  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ) {
    for await (const file of files) {
      if (shouldSkipPortableWorkspaceFile(file.path)) continue;
      await this.writeFile(computer, file, context);
    }
  }
  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.one<{ id: string; createdAt: string }>(
      { method: "snapshot", botId: computer.botId },
      context,
    );
  }
  async stop(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "stop", botId: computer.botId }, context);
  }
  async destroy(computer: ComputerRef, context: AdapterContext) {
    await this.one({ method: "destroy", botId: computer.botId }, context);
  }
  async connectScreen(
    computer: ComputerRef,
    request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    if (!(await this.hasScreen(computer, context)))
      return { url: null, mimeType: "text/html", close: async () => undefined };
    return this.desktop.connectScreen(computer, request, context);
  }
  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ) {
    if (!interactive && !(await this.hasScreen(computer, context))) return;
    await (await this.screen(computer, context)).setScreenControl(
      computer,
      interactive,
      context,
      controlToken,
    );
  }
  async releaseScreen(computer: ComputerRef, context: AdapterContext) {
    if (await this.hasScreen(computer, context))
      await this.desktop.releaseScreen(computer, context);
  }
  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    await (await this.screen(computer, context)).sendInput(computer, input, context);
  }
  async observe(computer: ComputerRef, context: AdapterContext) {
    return (await this.screen(computer, context)).observe(computer, context);
  }
  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return (await this.screen(computer, context)).act(computer, request, context);
  }
  async pageBrowser(
    computer: ComputerRef,
    request: PageBrowserCommand,
    context: AdapterContext,
  ): Promise<PageBrowserResult> {
    if (!(await this.hasScreen(computer, context)))
      return {
        ok: false,
        uncertain: false,
        fallback: "computer_act",
        error: "Page browser is unavailable on this computer.",
      };
    return this.desktop.pageBrowser(computer, request, context);
  }
  hostBrowserProfiles(computer: ComputerRef, context: AdapterContext) {
    return this.one<HostBrowserProfile[]>(
      { method: "browserProfiles", botId: computer.botId },
      context,
    );
  }
  async importHostBrowserSessions(
    computer: ComputerRef,
    request: HostBrowserImportRequest,
    context: AdapterContext,
  ) {
    const desktop = await this.screen(computer, context);
    await desktop.connectScreen(computer, { view: "stream" }, context);
    return this.one<HostBrowserImportResult>(
      {
        method: "importBrowserSessions",
        botId: computer.botId,
        screen: screenSessionKey(context),
        profile: request.profile,
        sites: request.sites,
      },
      context,
    );
  }
}
