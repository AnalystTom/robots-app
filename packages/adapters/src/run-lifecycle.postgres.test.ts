import { randomUUID } from "node:crypto";
import { runContinueJob } from "@robots/adapter-kit";
import type { PrismaClient } from "@robots/db";
import { asSystem, createDb, provisionMessagingIdentity, runAsSystem } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { requeueComputerRun } from "./run-lifecycle.js";

const url = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE === "1" && url ? describe : describe.skip;

describePostgres("a run waiting for its bot's computer (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let identity: { userId: string; spaceId: string; botId: string; threadId: string };
  let computerId: string;
  const address = `requeue-${randomUUID()}@robots.test`;

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma);
    identity = await runAsSystem("requeue fixture", () =>
      provisionMessagingIdentity(
        db.prisma,
        { provider: "email", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    const computer = await system.computer.create({
      data: {
        spaceId: identity.spaceId,
        userId: identity.userId,
        scopeKey: `requeue-${randomUUID()}`,
        homeKey: `requeue-${randomUUID()}`,
        kind: "fake",
      },
    });
    computerId = computer.id;
    await system.bot.update({ where: { id: identity.botId }, data: { computerId } });
  });

  afterAll(async () => {
    if (identity) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.organization.deleteMany({ where: { id: identity.spaceId } });
      await system.user.deleteMany({ where: { id: identity.userId } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  async function createRun(status: "running" | "completed") {
    const { userId, spaceId, botId, threadId } = identity;
    const task = await system.task.create({
      data: { userId, spaceId, botId, threadId, prompt: "fixture", status: "queued" },
    });
    return system.run.create({
      data: {
        userId,
        spaceId,
        botId,
        threadId,
        taskId: task.id,
        trigger: "user",
        status,
        leaseOwner: status === "running" ? "worker" : null,
        leaseFence: 1,
      },
    });
  }

  async function requeueBehindHolder(holderExpiresInMs: number) {
    const holder = await createRun("completed");
    await system.computerExecutionLease.upsert({
      where: { computerId_botId: { computerId, botId: identity.botId } },
      create: {
        computerId,
        botId: identity.botId,
        runId: holder.id,
        expiresAt: new Date(Date.now() + holderExpiresInMs),
      },
      update: { runId: holder.id, expiresAt: new Date(Date.now() + holderExpiresInMs) },
    });
    const waiting = await createRun("running");
    const enqueue = vi.fn(async () => undefined);
    const deps = { prisma: db.prisma, jobs: { enqueue } } as unknown as ExecutorDeps;
    await runAsSystem("requeue", () =>
      requeueComputerRun(deps, waiting.id, "worker", 1, null, false, {
        computerId,
        botId: identity.botId,
      }),
    );
    return { waiting, enqueue };
  }

  it("starts the run when the holder released before it was queued", async () => {
    const { waiting, enqueue } = await requeueBehindHolder(-1_000);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ...runContinueJob(waiting.id), availableAt: expect.any(Date) }),
    );
  });

  it("leaves the run for the holder's release while the computer is still held", async () => {
    const { enqueue } = await requeueBehindHolder(60_000);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
