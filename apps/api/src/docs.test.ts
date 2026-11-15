import { createRouterClient } from "@orpc/server";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@robots/adapter-kit";
import type { Actor } from "@robots/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@robots.test",
  isDeploymentOwner: true,
};

function doc(id: string, path: string, revision: number, updatedAt: string, botId?: string) {
  return {
    id,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: botId ?? null,
    scope: botId ? "bot" : "user",
    path,
    content: `# ${path}`,
    revision,
    createdAt: new Date(0),
    updatedAt: new Date(updatedAt),
  };
}

function client(prisma: unknown, extra: Partial<RouterDeps> = {}) {
  return createRouterClient(
    createRouter({
      prisma,
      env: { deploymentLabs: ["docs"] },
      ...extra,
    } as unknown as RouterDeps),
    { context: { actor } },
  );
}

describe("docs off for the account", () => {
  it("refuses every docs route after reading only the account's labs", async () => {
    const query = vi.fn(() => {
      throw new Error("Unexpected database access");
    });
    const findUnique = vi.fn(async () => ({ labs: ["board"] }));
    const prisma = new Proxy(
      { user: { findUnique } },
      { get: (target, key) => (key === "user" ? target.user : query) },
    );
    const commit = vi.fn();
    const docs = createRouterClient(
      createRouter({ prisma, env: {}, memory: { commit } } as unknown as RouterDeps),
      { context: { actor } },
    );
    for (const call of [
      () => docs.docs.list(),
      () => docs.docs.create({ name: "Mission" }),
      () => docs.docs.revisions({ documentId: "doc-1" }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(query).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

it("lists the Space's docs newest first with the bot that wrote each current revision", async () => {
  const findMany = vi.fn(async () => [
    doc("doc-2", "Roadmap.md", 3, "2026-11-02T00:00:00Z"),
    doc("doc-1", "MEMORY.md", 1, "2026-11-01T00:00:00Z", "bot-1"),
  ]);
  const revisions = vi.fn(async () => [
    { documentId: "doc-2", sourceRunId: "run-1" },
    { documentId: "doc-1", sourceRunId: null },
  ]);
  const runs = vi.fn(async () => [{ id: "run-1", botId: "bot-7" }]);
  const docs = client({
    memoryDocument: { findMany },
    memoryRevision: { findMany: revisions },
    run: { findMany: runs },
  });

  const listed = await docs.docs.list();

  expect(findMany).toHaveBeenCalledWith({
    where: { spaceId: actor.spaceId },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
  });
  expect(revisions).toHaveBeenCalledWith({
    where: {
      OR: [
        { documentId: "doc-2", revision: 3 },
        { documentId: "doc-1", revision: 1 },
      ],
    },
    select: { documentId: true, sourceRunId: true },
  });
  expect(runs).toHaveBeenCalledWith({
    where: { id: { in: ["run-1"] }, spaceId: actor.spaceId },
    select: { id: true, botId: true },
  });
  expect(listed).toMatchObject([
    { id: "doc-2", scope: "user", path: "Roadmap.md", editedByBotId: "bot-7" },
    { id: "doc-1", scope: "bot", botId: "bot-1", editedByBotId: null },
  ]);
});

it("lists nothing without reading revisions when the Space has no docs", async () => {
  const revisions = vi.fn();
  const docs = client({
    memoryDocument: { findMany: vi.fn(async () => []) },
    memoryRevision: { findMany: revisions },
  });
  await expect(docs.docs.list()).resolves.toEqual([]);
  expect(revisions).not.toHaveBeenCalled();
});

it("creates a shared Markdown doc that never overwrites one with the same name", async () => {
  const commit = vi.fn(async () => ({
    id: "doc-9",
    path: "Mission.md",
    revision: 1,
    content: "Ship it",
  }));
  const publishSpaceChange = vi.fn(async () => undefined);
  const docs = client({}, {
    memory: { commit },
    events: { publishSpaceChange },
  } as unknown as Partial<RouterDeps>);

  await expect(docs.docs.create({ name: " Mission ", content: "Ship it" })).resolves.toMatchObject({
    id: "doc-9",
    scope: "user",
    path: "Mission.md",
    editedByBotId: null,
  });
  expect(commit).toHaveBeenCalledWith(
    { scope: "user", path: "Mission.md", content: "Ship it", expectedRevision: 0 },
    expect.objectContaining({ spaceId: actor.spaceId, userId: actor.userId }),
  );
  expect(publishSpaceChange).toHaveBeenCalledWith(actor.spaceId, "memory");
});

it("reports a taken doc name as a conflict", async () => {
  const commit = vi.fn(async () => {
    throw new Error(MEMORY_REVISION_CONFLICT_ERROR);
  });
  const docs = client({}, { memory: { commit } } as unknown as Partial<RouterDeps>);
  await expect(docs.docs.create({ name: "notes.txt" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({ path: "notes.txt", content: "" }),
    expect.anything(),
  );
});

it("shows a doc's history newest first with who wrote each version", async () => {
  const findFirst = vi.fn(async () => ({ id: "doc-1" }));
  const revisions = vi.fn(async () => [
    {
      revision: 2,
      content: "two",
      sourceRunId: "run-1",
      createdAt: new Date("2026-11-02T00:00:00Z"),
    },
    { revision: 1, content: "one", sourceRunId: null, createdAt: new Date("2026-11-01T00:00:00Z") },
  ]);
  const docs = client({
    memoryDocument: { findFirst },
    memoryRevision: { findMany: revisions },
    run: { findMany: vi.fn(async () => [{ id: "run-1", botId: "bot-1" }]) },
  });

  await expect(docs.docs.revisions({ documentId: "doc-1" })).resolves.toEqual([
    { revision: 2, content: "two", createdAt: "2026-11-02T00:00:00.000Z", editedByBotId: "bot-1" },
    { revision: 1, content: "one", createdAt: "2026-11-01T00:00:00.000Z", editedByBotId: null },
  ]);
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: "doc-1", spaceId: actor.spaceId },
    select: { id: true },
  });
  expect(revisions).toHaveBeenCalledWith({
    where: { documentId: "doc-1" },
    orderBy: { revision: "desc" },
    take: 50,
  });
});

it("refuses the history of a doc outside the Space before reading revisions", async () => {
  const revisions = vi.fn();
  const docs = client({
    memoryDocument: { findFirst: vi.fn(async () => null) },
    memoryRevision: { findMany: revisions },
  });
  await expect(docs.docs.revisions({ documentId: "doc-other" })).rejects.toBeDefined();
  expect(revisions).not.toHaveBeenCalled();
});

it("signals a memory change after a person saves or deletes a memory document", async () => {
  const existing = doc("doc-1", "Roadmap.md", 1, "2026-11-01T00:00:00Z");
  const publishSpaceChange = vi.fn(async () => undefined);
  const docs = client({ memoryDocument: { findFirst: vi.fn(async () => existing) } }, {
    memory: {
      commit: vi.fn(async () => ({ ...existing, revision: 2 })),
      remove: vi.fn(async () => ({ removed: true })),
    },
    events: { publishSpaceChange },
  } as unknown as Partial<RouterDeps>);
  await docs.memory.update({ documentId: "doc-1", content: "next", expectedRevision: 1 });
  await docs.memory.remove({ documentId: "doc-1" });
  expect(publishSpaceChange.mock.calls).toEqual([
    [actor.spaceId, "memory"],
    [actor.spaceId, "memory"],
  ]);
});
