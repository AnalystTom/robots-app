import { mainRole, withModelRoles } from "@robots/adapters/testing/model-roles";
import type { Actor, Bot } from "@robots/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  isPrimaryBot,
  primaryBotGreeting,
  primaryBotLookAroundPrompt,
  startPrimaryBot,
} from "./primary-bot-intro.js";
import type { RouterDeps } from "./router.js";

const db = vi.hoisted(() => ({
  createMessage: vi.fn(async () => ({ id: "message-1" })),
  appendEvent: vi.fn(async () => ({ seq: 7 })),
}));
vi.mock("@robots/db", async (original) => ({
  ...(await original<typeof import("@robots/db")>()),
  createThreadMessageInTransaction: db.createMessage,
  appendEventInTransaction: db.appendEvent,
}));

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@robots.test",
  isDeploymentOwner: true,
} satisfies Actor;
const bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "RoBot",
  spawnKey: "primary",
} as unknown as Bot;

function deps(options: { hasCredential?: boolean; started?: boolean; agentRuntime?: string } = {}) {
  db.createMessage.mockClear();
  db.appendEvent.mockClear();
  let records = 0;
  const create = vi.fn(({ data }: { data: object }) => {
    records += 1;
    return Promise.resolve({ id: `record-${records}`, ...data });
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    message: { findFirst: vi.fn().mockResolvedValue(options.started ? { id: "old" } : null) },
    run: { findFirst: vi.fn().mockResolvedValue(null), create },
    task: { create },
  };
  const hasCredential = options.hasCredential ?? true;
  const routerDeps = {
    prisma: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      userModelPreference: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            hasCredential
              ? { modelId: "model-1", credential: { id: "cred-1", provider: "test" } }
              : null,
          ),
      },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue({ name: "Ada Lovelace" }) },
    },
    jobs: { enqueue: vi.fn().mockResolvedValue(undefined) },
    events: { notify: vi.fn().mockResolvedValue(undefined) },
    env: { agentRuntime: options.agentRuntime ?? "pi" },
  } as unknown as RouterDeps;
  withModelRoles(
    routerDeps.prisma,
    hasCredential ? [mainRole({ userId: "user-1" }, "test", "model-1")] : [],
  );
  return { deps: routerDeps, create };
}

describe("RoBot start", () => {
  it("knows RoBot by its spawn key", () => {
    expect(isPrimaryBot({ spawnKey: "primary" })).toBe(true);
    expect(isPrimaryBot({ spawnKey: "onboarding:first" })).toBe(false);
    expect(isPrimaryBot({ spawnKey: null })).toBe(false);
  });

  it("greets, then queues a full-tools first turn that looks around", async () => {
    const { deps: d, create } = deps();

    await startPrimaryBot(d, actor, bot);

    const [, message] = db.createMessage.mock.calls[0] as unknown as [
      unknown,
      { role: string; blocks: Array<{ text: string }> },
    ];
    expect(message.role).toBe("bot");
    expect(message.blocks[0]?.text).toBe(primaryBotGreeting("RoBot", true));
    expect(message.blocks[0]?.text).toMatch(/^Hey! I'm RoBot\. I'm new here\./);
    const [task, run] = create.mock.calls as Array<
      [{ data: { prompt?: string; trigger?: string; sourceMessageId?: string } }]
    >;
    expect(task?.[0].data.prompt).toBe(primaryBotLookAroundPrompt({ userName: "Ada Lovelace" }));
    // Not the creation intro, which may only ask what the Bot is for.
    expect(run?.[0].data.trigger).toBe("follow_up");
    expect(run?.[0].data.sourceMessageId).toBe("message-1");
    expect(d.events.notify).toHaveBeenCalledWith("thread-1", 7);
    expect(d.jobs.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ payload: { runId: "record-2" } }),
    );
  });

  it("still greets without a model, and says how to let it look around", async () => {
    const { deps: d, create } = deps({ hasCredential: false });

    await startPrimaryBot(d, actor, bot);

    const [, message] = db.createMessage.mock.calls[0] as unknown as [
      unknown,
      { blocks: Array<{ text: string }> },
    ];
    expect(message.blocks[0]?.text).toContain("Settings → Models");
    expect(create).not.toHaveBeenCalled();
    expect(d.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("does nothing for a RoBot that already started", async () => {
    const { deps: d, create } = deps({ started: true });

    await startPrimaryBot(d, actor, bot);

    expect(db.createMessage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(d.events.notify).not.toHaveBeenCalled();
  });

  it("asks the first turn to report progress and end on one concrete choice", () => {
    const prompt = primaryBotLookAroundPrompt({ userName: "Ada" });
    expect(prompt).toContain("Do not greet again");
    expect(prompt).toContain("list_fleet");
    expect(prompt).toContain("question with two options");
    expect(prompt).toContain("do not start work");
  });
});
