import { ORPCError } from "@orpc/server";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@robots/adapter-kit";
import type { Doc } from "@robots/contracts";
import { DOC_REVISIONS_LIMIT, docPath } from "@robots/contracts";
import type { PrismaClient } from "@robots/db";
import { IsolationError } from "@robots/db";
import type { RouterContext } from "./context.js";

/** The bot behind each run that wrote a revision; revisions a person saved have no run. */
async function editorsByRun(
  prisma: PrismaClient,
  spaceId: string,
  runIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(runIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const runs = await prisma.run.findMany({
    where: { id: { in: ids }, spaceId },
    select: { id: true, botId: true },
  });
  return new Map(runs.map((run) => [run.id, run.botId]));
}

/**
 * Docs are the Space's memory documents: the shared ones every bot reads and writes through its
 * memory tools, and each bot's own notes. Saving and deleting go through `memory.update` and
 * `memory.remove`; these add what the library needs on top.
 */
export function docsRoutes(ctx: RouterContext) {
  const { deps, docsEnabled } = ctx;
  return {
    docs: {
      list: docsEnabled.docs.list.handler(async ({ context }) => {
        const spaceId = context.actor.spaceId;
        const docs = await deps.prisma.memoryDocument.findMany({
          where: { spaceId },
          orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
        });
        const current =
          docs.length === 0
            ? []
            : await deps.prisma.memoryRevision.findMany({
                where: {
                  OR: docs.map((doc) => ({ documentId: doc.id, revision: doc.revision })),
                },
                select: { documentId: true, sourceRunId: true },
              });
        const runOf = new Map(current.map((row) => [row.documentId, row.sourceRunId]));
        const editors = await editorsByRun(deps.prisma, spaceId, [...runOf.values()]);
        return docs.map(
          (doc): Doc => ({
            id: doc.id,
            scope: doc.scope as "bot" | "user",
            botId: doc.botId,
            path: doc.path,
            content: doc.content,
            revision: doc.revision,
            updatedAt: doc.updatedAt.toISOString(),
            editedByBotId: editors.get(runOf.get(doc.id) ?? "") ?? null,
          }),
        );
      }),
      create: docsEnabled.docs.create.handler(async ({ context, input }) => {
        const saved = await deps.memory
          .commit(
            {
              scope: "user",
              path: docPath(input.name),
              content: input.content,
              // A doc that already has this name is never overwritten.
              expectedRevision: 0,
            },
            {
              operationId: "docs",
              traceId: "docs",
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              signal: context.signal ?? new AbortController().signal,
            },
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: "A doc with that name already exists." });
            }
            throw error;
          });
        return {
          id: saved.id,
          scope: "user",
          botId: null,
          path: saved.path,
          content: saved.content,
          revision: saved.revision,
          updatedAt: new Date().toISOString(),
          editedByBotId: null,
        };
      }),
      revisions: docsEnabled.docs.revisions.handler(async ({ context, input }) => {
        const spaceId = context.actor.spaceId;
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: { id: input.documentId, spaceId },
          select: { id: true },
        });
        if (!doc) throw new IsolationError();
        const rows = await deps.prisma.memoryRevision.findMany({
          where: { documentId: doc.id },
          orderBy: { revision: "desc" },
          take: DOC_REVISIONS_LIMIT,
        });
        const editors = await editorsByRun(
          deps.prisma,
          spaceId,
          rows.map((row) => row.sourceRunId),
        );
        return rows.map((row) => ({
          revision: row.revision,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
          editedByBotId: row.sourceRunId ? (editors.get(row.sourceRunId) ?? null) : null,
        }));
      }),
    },
  };
}
