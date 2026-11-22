import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";

type Row = Record<string, unknown>;

const notified = vi.hoisted(() => [] as unknown[]);

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async () => null,
  provisionComputer: async () => ({
    id: "computer-1",
    botId: "home-1",
    kind: "desktop",
    providerRef: "computer-1",
  }),
}));

vi.mock("./run-notifications.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyRun: async (_deps: unknown, _run: unknown, message: unknown) => {
    notified.push(message);
  },
}));

const scope = { userId: "user-1", spaceId: "space-1", botId: "bot-1" };

function recordingPrisma(models: Record<string, Record<string, unknown>>) {
  const fallback: Record<string, (...args: unknown[]) => unknown> = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    updateMany: async () => ({ count: 0 }),
  };
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, model: string) => {
        if (model === "$transaction") {
          return async (fn: (tx: unknown) => unknown) => fn(prisma);
        }
        if (model === "$queryRaw") return async () => [{ locked: 1 }];
        const methods =
          models[model] ??
          (model === "spaceMember" ? { findUnique: () => ({ id: "member-1" }) } : {});
        return new Proxy(methods, {
          get: (target, method: string) => {
            const impl = (target[method] ?? fallback[method]) as
              | ((...args: unknown[]) => unknown)
              | undefined;
            return async (...args: unknown[]) => (impl ? impl(...args) : null);
          },
        });
      },
    },
  );
  return prisma;
}

function world({ computerId, userId }: { computerId: string; userId: string }) {
  const run = {
    id: "run-1",
    botId: scope.botId,
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: scope.spaceId,
    userId,
    status: "queued",
    trigger: "message",
    routineId: null,
    retryOfRunId: null,
    leaseFence: 0,
  };
  const environment = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  let offeredNames: string[] = [];

  async function offeredTools() {
    const runtimeRun = vi.fn(async function* (request: { tools?: Array<{ name: string }> }) {
      offeredNames = (request.tools ?? []).map((tool) => tool.name);
      yield { type: "done" as const, text: "" };
    });
    const prisma = recordingPrisma({
      run: {
        findUnique: async () => run,
        findUniqueOrThrow: async () => run,
        findFirst: async () => ({ bot: { notifyOnFinish: false }, thread: { groupId: null } }),
        updateMany: async ({ data }: { data: Row }) => {
          Object.assign(run, data);
          return { count: 1 };
        },
        updateManyAndReturn: async () => [],
      },
      bot: {
        findUniqueOrThrow: async () => ({
          id: run.botId,
          name: "Assistant",
          title: "Assistant",
          description: "Test assistant",
          modelProvider: null,
          modelId: null,
          thinkingLevel: null,
          computerId,
          computerSwitching: false,
          memoryScope: null,
          computer: { id: computerId, scope: "dedicated", kind: "desktop", homeKey: "home-1" },
        }),
        findMany: async () => [],
      },
      attempt: {
        create: async () => ({ id: "attempt-1" }),
        updateMany: async () => ({ count: 1 }),
      },
      thread: {
        findUniqueOrThrow: async () => ({
          id: run.threadId,
          groupId: null,
          historyCompactionSummary: null,
          historyCompactedUpToSeq: null,
          nextMessageSeq: 1,
        }),
        update: async () => ({ nextMessageSeq: 1, nextEventSeq: 1 }),
      },
      message: { create: async ({ data }: { data: object }) => ({ id: "message-1", ...data }) },
      event: { create: async ({ data }: { data: object }) => ({ seq: 1, ...data }) },
      task: { findUniqueOrThrow: async () => ({ id: run.taskId, prompt: "Check the screen" }) },
      deploymentSettings: {
        findUnique: async () => ({ defaultModelProvider: "local", defaultModelId: "local-model" }),
      },
    });
    const executor = createRunExecutor({
      prisma,
      deploymentModelKey: "fake-deployment-key",
      runtime: { describe: () => ({ capabilities: { scripted: true } }), run: runtimeRun },
      sandbox: {
        describe: () => ({ id: "desktop", capabilities: { graphical: false } }),
        environment,
        releaseScreen: vi.fn(async () => undefined),
        execute: vi.fn(async function* () {
          yield { type: "exit" as const, code: 0 };
        }),
        async *exportWorkspace() {
          yield* [];
        },
      },
      home: { commit: vi.fn(async () => "fixture-revision") },
      memory: { read: async () => ({ documents: [] }) },
      memoryProviders: { resolve: async () => null },
      artifacts: { get: vi.fn() },
      events: {
        append: vi.fn(async () => undefined),
        finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
        pauseRunForTakeover: vi.fn(async () => false),
        pauseRunForInput: vi.fn(async () => true),
        notify: vi.fn(async () => undefined),
      },
      jobs: { enqueue: vi.fn(async () => undefined) },
      notifications: { send: vi.fn(async () => undefined) },
      secrets: [],
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    run.status = "queued";
    await executor.continueRun(run.id, "worker-1");
    return offeredNames;
  }

  return { environment, offeredTools };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("graphical tools on a host computer", () => {
  it("keeps graphical tools offered when a later environment read fails", async () => {
    const run = world({ computerId: "host-screen-kept", userId: "admin-1" });
    run.environment.mockResolvedValueOnce({
      platform: "linux",
      home: "/home/owner",
      shell: "bash",
      screen: true,
    });
    expect(await run.offeredTools()).toContain("computer_observe");
    run.environment.mockRejectedValueOnce(new Error("The host did not answer"));
    expect(await run.offeredTools()).toContain("computer_observe");
  });

  it("keeps the admin's last answer when a member's run on the same host reports no screen", async () => {
    const admin = world({ computerId: "host-screen-shared", userId: "admin-1" });
    admin.environment.mockResolvedValueOnce({
      platform: "linux",
      home: "/home/owner",
      shell: "bash",
      screen: true,
    });
    expect(await admin.offeredTools()).toContain("computer_observe");

    const member = world({ computerId: "host-screen-shared", userId: "member-1" });
    member.environment.mockResolvedValueOnce({
      platform: "linux",
      home: "/home/owner",
      shell: "bash",
      screen: false,
    });
    expect(await member.offeredTools()).not.toContain("computer_observe");

    const adminLater = world({ computerId: "host-screen-shared", userId: "admin-1" });
    adminLater.environment.mockRejectedValueOnce(new Error("The host did not answer"));
    expect(await adminLater.offeredTools()).toContain("computer_observe");
  });

  it("stays non-graphical for a host that has never answered", async () => {
    const run = world({ computerId: "host-screen-never", userId: "admin-1" });
    run.environment.mockRejectedValue(new Error("The host did not answer"));
    expect(await run.offeredTools()).not.toContain("computer_observe");
  });
});
