import { createRouterClient } from "@orpc/server";
import type { Actor } from "@robots/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@robots.test",
  isDeploymentOwner: false,
};
const since = "2026-11-15T00:00:00.000Z";

function runRow(id: string, status: string) {
  return {
    id,
    botId: "bot-1",
    threadId: "thread-1",
    status,
    trigger: "user",
    updatedAt: new Date("2026-11-15T09:00:00Z"),
    completedAt: new Date("2026-11-15T10:00:00Z"),
    bot: { name: "Helper", archivedAt: null, notifyOnFinish: true },
    task: { prompt: "Write the  weekly\nreport" },
    sourceMessage: null,
    thread: { groupId: null, group: null },
  };
}

function client(labs: string[], run: object) {
  const prisma = { user: { findUnique: vi.fn(async () => ({ labs })) }, run };
  return createRouterClient(createRouter({ prisma, env: {} } as unknown as RouterDeps), {
    context: { actor },
  });
}

describe("today.runs", () => {
  it("is hidden until the account turns Today on", async () => {
    const findMany = vi.fn();
    await expect(client(["board"], { findMany }).today.runs({ since })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("lists the space's runs that ended since the given time and counts the completed ones", async () => {
    const findMany = vi.fn(async () => [runRow("run-2", "failed"), runRow("run-1", "completed")]);
    const count = vi.fn(async () => 7);
    const result = await client(["today"], { findMany, count }).today.runs({ since });

    expect(result.finished).toBe(7);
    expect(result.runs.map((run) => [run.runId, run.status])).toEqual([
      ["run-2", "failed"],
      ["run-1", "completed"],
    ]);
    expect(result.runs[0]).toMatchObject({
      botName: "Helper",
      promptSnippet: "Write the weekly report",
      updatedAt: "2026-11-15T10:00:00.000Z",
    });
    const findArgs = findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; take: number },
    ];
    const { where, take } = findArgs[0];
    expect(where).toMatchObject({
      spaceId: "space-1",
      bot: { archivedAt: null },
      status: { in: ["completed", "failed", "cancelled"] },
      completedAt: { gte: new Date(since) },
    });
    expect(take).toBe(20);
    expect(count).toHaveBeenCalledWith({ where: { ...where, status: "completed" } });
  });

  it("rejects a start that is not a timestamp", async () => {
    const findMany = vi.fn();
    await expect(
      client(["today"], { findMany }).today.runs({ since: "yesterday" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(findMany).not.toHaveBeenCalled();
  });
});
