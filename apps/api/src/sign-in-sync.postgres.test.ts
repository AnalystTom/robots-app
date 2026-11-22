import { randomUUID } from "node:crypto";
import { RPCHandler } from "@orpc/server/fetch";
import type { PageBrowserCommand, PageBrowserResult } from "@robots/adapter-kit";
import { EncryptedSecretStore, importBrowserSessions } from "@robots/adapters";
import type { Actor, SiteSession } from "@robots/contracts";
import type { PrismaClient } from "@robots/db";
import { asSystem, createDb } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const url = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE === "1" && url ? describe : describe.skip;

const TOKEN = "fake-session-token-sync";

function session(site = "x.com"): SiteSession {
  return {
    site,
    cookies: [
      {
        name: "auth_token",
        value: TOKEN,
        domain: site,
        hostOnly: false,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "None",
        expires: Math.floor(Date.now() / 1000) + 86_400,
      },
    ],
  };
}

describePostgres("a sign-in item's bot changes reach the browser (PostgreSQL)", () => {
  const stamp = randomUUID();
  const owner = `${stamp}-owner`;
  const botA = `${stamp}-bot-a`;
  const botB = `${stamp}-bot-b`;
  const secrets = new EncryptedSecretStore("test-only-encryption-key");
  const calls: Array<{ request: PageBrowserCommand; botId?: string }> = [];
  const sandbox = {
    pageBrowser: async (
      _computer: unknown,
      request: PageBrowserCommand,
      context: { botId?: string },
    ): Promise<PageBrowserResult> => {
      calls.push({ request, botId: context.botId });
      return { ok: true };
    },
  };
  const actor: Actor = {
    userId: owner,
    spaceId: owner,
    email: `${owner}@robots.test`,
    isDeploymentOwner: false,
  };
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let router: ReturnType<typeof createRouter>;

  const put = async (body: Record<string, unknown>) => {
    const { response } = await new RPCHandler(router).handle(
      new Request("https://api.example.test/rpc/vault/put", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    expect(response?.status).toBe(200);
  };
  const itemDestination = (name: string) => ({
    name,
    origin: "https://x.com",
    auth: { type: "login" },
  });
  const deliveredTo = (botId: string) =>
    calls.some(
      (call) =>
        call.botId === botId &&
        call.request.command === "sessions" &&
        call.request.sites.some(
          (entry) =>
            entry.site === "x.com" && entry.cookies.some((cookie) => cookie.value === TOKEN),
        ),
    );
  const clearedFor = (botId: string) =>
    calls.some(
      (call) =>
        call.botId === botId &&
        call.request.command === "sessions" &&
        call.request.clear?.includes("x.com") === true,
    );

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma);
    await system.user.create({
      data: { id: owner, name: "Sessions", email: `${owner}@robots.test`, emailVerified: false },
    });
    await system.organization.create({
      data: { id: owner, name: "Sessions", slug: owner, createdAt: new Date() },
    });
    await system.space.create({ data: { id: owner, organizationId: owner, name: "Sessions" } });
    await system.member.create({
      data: {
        id: `${owner}-member`,
        organizationId: owner,
        userId: owner,
        role: "member",
        createdAt: new Date(),
      },
    });
    await system.spaceMember.create({
      data: {
        id: `${owner}-space`,
        spaceId: owner,
        organizationId: owner,
        userId: owner,
        createdAt: new Date(),
      },
    });
    await system.computer.create({
      data: {
        id: owner,
        spaceId: owner,
        userId: owner,
        scopeKey: owner,
        homeKey: owner,
        kind: "docker",
        state: "running",
        providerRef: `${owner}-container`,
      },
    });
    for (const id of [botA, botB]) {
      await system.bot.create({
        data: { id, spaceId: owner, userId: owner, name: id, color: "#000000", computerId: owner },
      });
    }
    router = createRouter({
      prisma: db.prisma,
      env: {},
      secrets,
      sandbox,
    } as unknown as RouterDeps);
    await importBrowserSessions(
      { prisma: db.prisma, secretStore: secrets },
      { userId: owner, spaceId: owner },
      { source: "Thomas in Chrome", botIds: [botA], sessions: [session()] },
    );
  });

  afterAll(async () => {
    if (system) {
      await system.organization.deleteMany({ where: { id: owner } });
      await system.user.deleteMany({ where: { id: owner } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("delivers a sign-in to a bot checked on the item, and clears it when the item's policy is off", async () => {
    const [item] = await system.vaultCredential.findMany({ where: { userId: owner } });
    await put({
      destination: itemDestination(item!.name),
      allBots: false,
      botIds: [botA, botB],
    });
    await vi.waitFor(() => expect(deliveredTo(botB)).toBe(true), { timeout: 10_000 });

    await put({ destination: itemDestination(item!.name), policy: "off" });
    await vi.waitFor(() => expect(clearedFor(botB)).toBe(true), { timeout: 10_000 });
    expect(clearedFor(botA)).toBe(true);
  });

  it("delivers again to every checked bot when the item's policy is turned back on", async () => {
    const [item] = await system.vaultCredential.findMany({ where: { userId: owner } });
    const before = calls.length;
    await put({ destination: itemDestination(item!.name), policy: "allow" });
    await vi.waitFor(
      () => {
        const later = calls.slice(before);
        expect(
          [botA, botB].every((botId) =>
            later.some(
              (call) =>
                call.botId === botId &&
                call.request.command === "sessions" &&
                call.request.sites.some((entry) => entry.site === "x.com"),
            ),
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
  });
});
