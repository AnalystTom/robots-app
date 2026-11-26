import { runContinueJob } from "@robots/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { returnHelperOutcome } from "./background-helpers.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { failRunBeforeTurn, requeueComputerRun, startNextWaitingRun } from "./run-lifecycle.js";
import { notifyRun } from "./run-notifications.js";

vi.mock("./run-notifications.js", () => ({ notifyRun: vi.fn(async () => undefined) }));
vi.mock("./background-helpers.js", () => ({ returnHelperOutcome: vi.fn(async () => undefined) }));

function deps(next: { id: string } | null) {
  const findFirst = vi.fn(async () => next);
  const enqueue = vi.fn(async () => undefined);
  return {
    deps: { prisma: { run: { findFirst } }, jobs: { enqueue } } as unknown as ExecutorDeps,
    findFirst,
    enqueue,
  };
}

describe("starting the next run waiting for a bot's computer", () => {
  it("starts the oldest other due run of the bot, leaving failure backoff alone", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z") });
    try {
      const f = deps({ id: "waiting" });
      await startNextWaitingRun(f.deps, "bot", "finished");
      expect(f.findFirst).toHaveBeenCalledWith({
        where: {
          botId: "bot",
          status: "queued",
          id: { not: "finished" },
          OR: [{ wakeAt: null }, { wakeAt: { lte: new Date("2026-10-28T12:00:00Z") } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      expect(f.enqueue).toHaveBeenCalledExactlyOnceWith(runContinueJob("waiting"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when no run is waiting", async () => {
    const f = deps(null);
    await startNextWaitingRun(f.deps, "bot", "finished");
    expect(f.enqueue).not.toHaveBeenCalled();
  });
});

describe("failing a run before its turn", () => {
  it("brings a background helper's failure back to its chat instead of pushing a notice", async () => {
    const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
    const deps = { events: { finalizeRun } } as unknown as ExecutorDeps;
    const run = (trigger: string) => ({
      id: `${trigger}-run`,
      spaceId: "space",
      userId: "user",
      botId: "bot",
      threadId: "thread",
      taskId: "task",
      trigger,
    });
    const lease = { attemptId: "attempt", workerId: "worker", fence: 1 };

    await failRunBeforeTurn(deps, run("helper"), "Chief", lease, "model not connected");
    expect(returnHelperOutcome).toHaveBeenCalledExactlyOnceWith(deps, run("helper"), {
      status: "failed",
      text: "model not connected",
    });
    expect(notifyRun).not.toHaveBeenCalled();

    await failRunBeforeTurn(deps, run("user"), "Chief", lease, "model not connected");
    expect(notifyRun).toHaveBeenCalledOnce();
    expect(returnHelperOutcome).toHaveBeenCalledOnce();
  });
});

describe("queueing a run until its bot's computer is released", () => {
  function requeueDeps(heldBy: { id: string } | null) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findFirst = vi.fn(async () => ({ id: "waiting" }));
    const enqueue = vi.fn(async () => undefined);
    const lease = vi.fn(async () => heldBy);
    return {
      deps: {
        prisma: { run: { updateMany, findFirst }, computerExecutionLease: { findFirst: lease } },
        jobs: { enqueue },
      } as unknown as ExecutorDeps,
      enqueue,
    };
  }

  it("starts the run itself when the holder released before it was queued", async () => {
    const f = requeueDeps(null);
    await requeueComputerRun(f.deps, "waiting", "worker", 1, null, false, {
      computerId: "computer",
      botId: "bot",
    });
    expect(f.enqueue).toHaveBeenCalledExactlyOnceWith(runContinueJob("waiting"));
  });

  it("leaves the run for the holder's release when the computer is still held", async () => {
    const f = requeueDeps({ id: "lease" });
    await requeueComputerRun(f.deps, "waiting", "worker", 1, null, false, {
      computerId: "computer",
      botId: "bot",
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
});
