import { randomUUID } from "node:crypto";
import type { PageBrowserCommand, PageBrowserResult } from "@robots/adapter-kit";
import type { SiteSession } from "@robots/contracts";
import { VAULT_ITEM_LIMIT } from "@robots/contracts";
import { asSystem, createDb, runAsTenant } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forgetBotSecret, listBotSecrets, listVaultItems, revealBotSecret } from "./bot-secrets.js";
import {
  importBrowserSessions,
  SESSIONS_NEED_OWN_SPACE,
  SESSIONS_NOT_ON_THIS_COMPUTER,
  sessionItemBots,
  syncBotBrowserSessions,
  syncComputerBrowserSessions,
} from "./browser-session-vault.js";
import { EncryptedSecretStore } from "./secrets.js";

const url = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE === "1" && url ? describe : describe.skip;

const TOKEN = "fake-session-token-one";
const ROTATED = "fake-session-token-two";

function session(value: string, site = "x.com"): SiteSession {
  return {
    site,
    cookies: [
      {
        name: "auth_token",
        value,
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

describePostgres("imported browser sessions (PostgreSQL)", () => {
  const stamp = randomUUID();
  const owner = `${stamp}-owner`;
  const other = `${stamp}-other`;
  const secretStore = new EncryptedSecretStore("test-only-encryption-key");
  const calls: Array<{ request: PageBrowserCommand; botId?: string }> = [];
  let browserRefuses = false;
  const sandbox = {
    pageBrowser: async (
      _computer: unknown,
      request: PageBrowserCommand,
      context: { botId?: string },
    ): Promise<PageBrowserResult> => {
      calls.push({ request, botId: context.botId });
      return browserRefuses ? { ok: false, error: "The browser refused." } : { ok: true };
    },
  };
  let db: ReturnType<typeof createDb>;
  let system: ReturnType<typeof createDb>["prisma"];
  const scope = { userId: owner, spaceId: owner };
  const botId = `${stamp}-bot`;
  const otherBotId = `${stamp}-bot-2`;
  const context = () => ({
    operationId: "browser-sessions-test",
    traceId: "browser-sessions-test",
    signal: new AbortController().signal,
  });
  const deps = () => ({ prisma: db.prisma, secretStore, sandbox });
  const asOwner = <T>(fn: () => Promise<T>) => runAsTenant(scope, fn);
  const sync = () => syncBotBrowserSessions(deps(), botId, context());
  const join = async (id: string) => {
    await system.member.create({
      data: {
        id: `${id}-member`,
        organizationId: owner,
        userId: id,
        role: "member",
        createdAt: new Date(),
      },
    });
    await system.spaceMember.create({
      data: {
        id: `${id}-space`,
        spaceId: owner,
        organizationId: owner,
        userId: id,
        createdAt: new Date(),
      },
    });
  };
  const applied = async () =>
    (await system.browserSessionSite.findMany({ where: { botId } })).map((row) => row.site);

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma);
    for (const id of [owner, other]) {
      await system.user.create({
        data: { id, name: "Sessions", email: `${id}@example.test`, emailVerified: false },
      });
    }
    await system.organization.create({
      data: { id: owner, name: "Sessions", slug: owner, createdAt: new Date() },
    });
    await system.space.create({ data: { id: owner, organizationId: owner, name: "Sessions" } });
    await join(owner);
    await system.computer.create({
      data: {
        id: owner,
        spaceId: owner,
        userId: owner,
        scopeKey: owner,
        homeKey: owner,
        kind: "docker",
        state: "stopped",
      },
    });
    for (const id of [botId, otherBotId]) {
      await system.bot.create({
        data: { id, spaceId: owner, userId: owner, name: id, color: "#000000", computerId: owner },
      });
    }
  });

  afterAll(async () => {
    if (system) {
      await system.organization.deleteMany({ where: { id: owner } });
      await system.user.deleteMany({ where: { id: { in: [owner, other] } } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("saves a site's session sealed, for its chosen bot only, never shown to a bot", async () => {
    const sites = await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Thomas in Chrome",
        botIds: [botId],
        sessions: [session(TOKEN)],
      }),
    );
    expect(sites).toEqual(["x.com"]);
    const [row] = await system.vaultCredential.findMany({ where: { userId: owner } });
    expect(row).toMatchObject({
      auth: { type: "session" },
      origin: "https://x.com",
      title: "x.com",
      note: "Thomas in Chrome",
    });
    expect(row!.ciphertext).not.toContain(TOKEN);
    expect(await asOwner(() => sessionItemBots(db.prisma, scope, row!.name))).toEqual([botId]);
    const owned = await asOwner(() => listVaultItems(db.prisma, secretStore, scope));
    expect(owned.map((item) => item.auth)).toEqual([{ type: "session" }]);
    const botView = await asOwner(() =>
      listBotSecrets(db.prisma, secretStore, { ...scope, botId }),
    );
    expect(botView).toEqual([]);
    expect(
      await asOwner(() =>
        revealBotSecret({ prisma: db.prisma, secretStore, scope, name: row!.name }),
      ),
    ).toBeNull();
  });

  it("waits for a stopped computer, then signs the running browser in once", async () => {
    expect(await sync()).toBe("next_start");
    expect(calls).toEqual([]);
    await system.computer.update({
      where: { id: owner },
      data: { state: "running", providerRef: `${stamp}-container` },
    });
    expect(await sync()).toBe("signed_in");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      botId,
      request: { command: "sessions", clear: [], sites: [{ site: "x.com" }] },
    });
    const sent = calls[0]!.request as Extract<PageBrowserCommand, { command: "sessions" }>;
    expect(sent.sites[0]!.cookies[0]!.value).toBe(TOKEN);
    expect(await applied()).toEqual(["x.com"]);
    expect(await sync()).toBe("signed_in");
    await syncComputerBrowserSessions(deps(), owner, context());
    expect(calls).toHaveLength(1);
    expect(await syncBotBrowserSessions(deps(), otherBotId, context())).toBe("signed_in");
    expect(calls).toHaveLength(1);
  });

  it("sends a fresh import again and signs the browser out when the item is removed", async () => {
    await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Work in Chromium",
        botIds: [botId],
        sessions: [session(ROTATED)],
      }),
    );
    expect(await system.vaultCredential.count({ where: { userId: owner } })).toBe(1);
    expect(await sync()).toBe("signed_in");
    const resent = calls.at(-1)!.request as Extract<PageBrowserCommand, { command: "sessions" }>;
    expect(resent.sites[0]!.cookies[0]!.value).toBe(ROTATED);
    const [row] = await system.vaultCredential.findMany({ where: { userId: owner } });
    await asOwner(() => forgetBotSecret(db.prisma, scope, row!.name));
    expect(await sync()).toBe("signed_in");
    expect(calls.at(-1)!.request).toEqual({ command: "sessions", sites: [], clear: ["x.com"] });
    expect(await applied()).toEqual([]);
  });

  it("refuses an import that would pass the vault limit, saving none of its sites", async () => {
    const fillers = Array.from({ length: VAULT_ITEM_LIMIT - 1 }, (_, index) => ({
      id: `${stamp}-filler-${index}`,
      userId: owner,
      name: `filler ${index}`,
      origin: `https://filler${index}.example`,
      auth: { type: "password" },
      ciphertext: "filler",
    }));
    await system.vaultCredential.createMany({ data: fillers });
    const before = await system.vaultCredential.count({ where: { userId: owner } });
    expect(before).toBe(VAULT_ITEM_LIMIT - 1);
    await expect(
      asOwner(() =>
        importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
          source: "Thomas in Chrome",
          botIds: [],
          sessions: [
            session(TOKEN, "a.com"),
            session(TOKEN, "b.com"),
          ],
        }),
      ),
    ).rejects.toThrow("Credential limit reached");
    expect(await system.vaultCredential.count({ where: { userId: owner } })).toBe(before);
    expect(
      await system.vaultCredential.count({ where: { userId: owner, origin: "https://a.com" } }),
    ).toBe(0);
    await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Thomas in Chrome",
        botIds: [],
        sessions: [session(TOKEN, "a.com")],
      }),
    );
    expect(await system.vaultCredential.count({ where: { userId: owner } })).toBe(
      VAULT_ITEM_LIMIT,
    );
    await system.vaultCredential.deleteMany({ where: { userId: owner } });
  });

  it("never delivers a sign-in to a bot on this computer", async () => {
    const settings = await system.deploymentSettings.findUnique({ where: { id: "default" } });
    const previous = settings?.computerHost ?? null;
    await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Thomas in Chrome",
        botIds: [botId],
        sessions: [session(TOKEN)],
      }),
    );
    const sentBefore = calls.length;
    await system.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", computerHost: "this-mac" },
      update: { computerHost: "this-mac" },
    });
    try {
      expect(await sync()).toBe("failed");
      expect(calls).toHaveLength(sentBefore);
      await expect(
        asOwner(() =>
          importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
            source: "Thomas in Chrome",
            botIds: [botId],
            sessions: [session(ROTATED)],
          }),
        ),
      ).rejects.toThrow(SESSIONS_NOT_ON_THIS_COMPUTER);
    } finally {
      await system.deploymentSettings.update({
        where: { id: "default" },
        data: { computerHost: previous },
      });
    }
    const [row] = await system.vaultCredential.findMany({ where: { userId: owner } });
    await asOwner(() => forgetBotSecret(db.prisma, scope, row!.name));
    expect(await sync()).toBe("signed_in");
    expect(await applied()).toEqual([]);
  });

  it("keeps a removed sign-in recorded while the browser refuses its sign-out", async () => {
    await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Thomas in Chrome",
        botIds: [botId],
        sessions: [session(TOKEN)],
      }),
    );
    expect(await sync()).toBe("signed_in");
    expect(await applied()).toEqual(["x.com"]);
    const [row] = await system.vaultCredential.findMany({ where: { userId: owner } });
    await asOwner(() => forgetBotSecret(db.prisma, scope, row!.name));
    browserRefuses = true;
    try {
      expect(await sync()).toBe("failed");
      expect(await applied()).toEqual(["x.com"]);
    } finally {
      browserRefuses = false;
    }
    expect(await sync()).toBe("signed_in");
    expect(await applied()).toEqual([]);
  });

  it("refuses a shared Space and signs its browsers out", async () => {
    await asOwner(() =>
      importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
        source: "Thomas in Chrome",
        botIds: [botId],
        sessions: [session(TOKEN)],
      }),
    );
    expect(await sync()).toBe("signed_in");
    expect(await applied()).toEqual(["x.com"]);
    await join(other);
    await expect(
      asOwner(() =>
        importBrowserSessions({ prisma: db.prisma, secretStore }, scope, {
          source: "Thomas in Chrome",
          botIds: [botId],
          sessions: [session(TOKEN)],
        }),
      ),
    ).rejects.toThrow(SESSIONS_NEED_OWN_SPACE);
    expect(await sync()).toBe("signed_in");
    expect(calls.at(-1)!.request).toEqual({ command: "sessions", sites: [], clear: ["x.com"] });
    expect(await applied()).toEqual([]);
  });
});
