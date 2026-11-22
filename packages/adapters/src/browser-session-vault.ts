import { randomBytes } from "node:crypto";
import type { AdapterContext, SandboxProvider, SecretStore } from "@robots/adapter-kit";
import type {
  ImportSessionsInput,
  SessionCookie,
  SessionDelivery,
  SiteSession,
} from "@robots/contracts";
import {
  SESSION_SITES_PER_REQUEST,
  SessionSiteCookies,
  sessionOriginSite,
  sessionSiteOrigin,
  VAULT_ITEM_LIMIT,
} from "@robots/contracts";
import type { PrismaClient, ThreadEvents } from "@robots/db";
import { runAsSystem, runAsTenant, spaceIsShared, withTransactionRetry } from "@robots/db";
import { getLogger } from "@robots/logging";
import { advisoryLock } from "./advisory-lock.js";
import type { BotSecretScope } from "./bot-secrets.js";
import {
  assertVaultInUse,
  isSessionAuth,
  lockVault,
  newVaultItemName,
  saveItemBots,
  sessionItemVersion,
  vaultFields,
} from "./bot-secrets.js";
import { toComputerRef } from "./computer-support.js";
import { sandboxKindForBot } from "./host-aware-sandbox.js";
import { persistPreparedSecret } from "./secret-persistence.js";
import { openVaultValue, sealVaultValue } from "./vault-values.js";

export const SESSIONS_NEED_OWN_SPACE =
  "Sign-ins can only be imported into a Space that only you use.";
export const SESSION_IMPORT_TOO_LARGE = "Too many sign-ins at once. Pick fewer sites.";
export const SESSIONS_NOT_ON_THIS_COMPUTER =
  "Sign-ins can only go to a bot on your own Docker computer, not this computer.";

const SESSION_AUTH = { type: "session" } as const;
const SESSION_TYPE = { path: ["type"], equals: "session" };
const MAX_BATCH_BYTES = 600_000;

export interface SessionVaultDeps {
  prisma: PrismaClient;
  secretStore: SecretStore;
}

export interface SessionSyncDeps extends SessionVaultDeps {
  sandbox: Pick<SandboxProvider, "pageBrowser">;
  events?: Pick<ThreadEvents, "publishSpaceChange">;
}

function sealContext(scope: BotSecretScope, id: string): AdapterContext {
  return {
    operationId: id,
    traceId: id,
    userId: scope.userId,
    spaceId: scope.spaceId,
    signal: new AbortController().signal,
  };
}

export async function importBrowserSessions(
  deps: SessionVaultDeps,
  scope: BotSecretScope,
  input: Pick<ImportSessionsInput, "source" | "botIds" | "sessions">,
): Promise<string[]> {
  const { prisma, secretStore } = deps;
  if (await spaceIsShared(prisma, scope.spaceId)) throw new Error(SESSIONS_NEED_OWN_SPACE);
  if (Buffer.byteLength(JSON.stringify(input.sessions)) > MAX_BATCH_BYTES) {
    throw new Error(SESSION_IMPORT_TOO_LARGE);
  }
  await assertVaultInUse(prisma, scope);
  const targets = await runAsTenant({ spaceId: scope.spaceId, userId: scope.userId }, () =>
    prisma.bot.findMany({
      where: { spaceId: scope.spaceId, id: { in: [...input.botIds] } },
      select: { computer: { select: { kind: true } } },
    }),
  );
  for (const target of targets) {
    if (await onThisComputer(prisma, target.computer))
      throw new Error(SESSIONS_NOT_ON_THIS_COMPUTER);
  }
  await assertRoomFor(
    prisma,
    scope,
    input.sessions.map((session) => sessionSiteOrigin(session.site)),
  );
  const sites: string[] = [];
  for (const session of input.sessions) {
    await withTransactionRetry(async () => {
      const vault = await vaultFields(prisma, scope);
      const origin = sessionSiteOrigin(session.site);
      const existing = await prisma.vaultCredential.findFirst({
        where: { ...vault, origin, auth: SESSION_TYPE },
        select: { id: true },
      });
      const id = existing?.id ?? randomBytes(12).toString("hex");
      const ciphertext = await sealVaultValue(
        prisma,
        secretStore,
        { id, ...vault },
        JSON.stringify(session.cookies),
        sealContext(scope, id),
      );
      const name = existing
        ? undefined
        : await newVaultItemName(prisma, scope, `session ${session.site}`, "session");
      await persistPreparedSecret(prisma, secretStore, { id, ciphertext }, () =>
        prisma.$transaction(async (tx) => {
          await lockVault(tx, scope);
          await assertVaultInUse(tx, scope);
          if (existing) {
            await tx.vaultCredential.update({
              where: { id },
              data: { ciphertext, note: input.source },
            });
            const chosen = await tx.vaultCredentialBot.findMany({
              where: { credentialId: id, userId: scope.userId, spaceId: scope.spaceId },
              select: { botId: true },
            });
            await saveItemBots(tx, scope, id, {
              botIds: [...new Set([...chosen.map((row) => row.botId), ...input.botIds])],
            });
            return;
          }
          if ((await tx.vaultCredential.count({ where: vault })) >= VAULT_ITEM_LIMIT) {
            throw new Error("Credential limit reached");
          }
          await tx.vaultCredential.create({
            data: {
              id,
              ...vault,
              name: name as string,
              origin,
              auth: SESSION_AUTH,
              title: session.site,
              note: input.source,
              ciphertext,
            },
          });
          await saveItemBots(tx, scope, id, { botIds: input.botIds });
        }),
      );
    });
    sites.push(session.site);
  }
  return sites;
}

export type SessionVaultScope = BotSecretScope;

async function onThisComputer(
  prisma: PrismaClient,
  computer: { kind: string } | null,
): Promise<boolean> {
  if (!computer) return false;
  const settings = await runAsSystem("deployment computer host lookup", () =>
    prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { computerHost: true },
    }),
  );
  return sandboxKindForBot(computer.kind, settings?.computerHost) === "desktop";
}

async function assertRoomFor(
  prisma: PrismaClient,
  scope: BotSecretScope,
  origins: readonly string[],
): Promise<void> {
  const vault = await vaultFields(prisma, scope);
  const stored = await prisma.vaultCredential.findMany({
    where: { ...vault, auth: SESSION_TYPE },
    select: { origin: true },
  });
  const known = new Set(stored.map((row) => row.origin));
  const added = new Set(origins.filter((origin) => !known.has(origin))).size;
  if ((await prisma.vaultCredential.count({ where: vault })) + added > VAULT_ITEM_LIMIT) {
    throw new Error("Credential limit reached");
  }
}

function receivingKey(origin: string, botId: string): string {
  return JSON.stringify([origin, botId]);
}

export async function signingOutSites(
  prisma: PrismaClient,
  scope: BotSecretScope,
): Promise<string[]> {
  const [applied, live] = await Promise.all([
    prisma.browserSessionSite.findMany({
      where: { userId: scope.userId, spaceId: scope.spaceId },
      select: { botId: true, site: true },
    }),
    prisma.vaultCredential.findMany({
      where: {
        ...(await vaultFields(prisma, scope)),
        auth: SESSION_TYPE,
        policy: { not: "off" },
      },
      select: { origin: true, bots: { select: { botId: true } } },
    }),
  ]);
  const receiving = new Set(
    live.flatMap((row) => row.bots.map((bot) => receivingKey(row.origin, bot.botId))),
  );
  const pending = applied.filter(
    (row) => !receiving.has(receivingKey(sessionSiteOrigin(row.site), row.botId)),
  );
  return [...new Set(pending.map((row) => row.site))].sort();
}

export async function sessionItemBots(
  prisma: PrismaClient,
  scope: BotSecretScope,
  name: string,
): Promise<string[]> {
  const row = await prisma.vaultCredential.findFirst({
    where: { ...(await vaultFields(prisma, scope)), name },
    select: { auth: true, bots: { select: { botId: true } } },
  });
  return row && isSessionAuth(row.auth) ? row.bots.map((bot) => bot.botId) : [];
}

interface DesiredSite {
  site: string;
  version: string;
  open: () => Promise<SessionCookie[]>;
}

async function desiredSites(
  deps: SessionVaultDeps,
  bot: { id: string; userId: string; spaceId: string },
): Promise<DesiredSite[]> {
  if (await spaceIsShared(deps.prisma, bot.spaceId)) return [];
  const scope = { userId: bot.userId, spaceId: bot.spaceId };
  const rows = await deps.prisma.vaultCredential.findMany({
    where: {
      ...(await vaultFields(deps.prisma, scope)),
      auth: SESSION_TYPE,
      policy: { not: "off" },
      bots: { some: { botId: bot.id } },
    },
    select: {
      id: true,
      userId: true,
      spaceId: true,
      ciphertext: true,
      origin: true,
      updatedAt: true,
    },
  });
  return rows.flatMap((row) => {
    const site = sessionOriginSite(row.origin);
    if (!site) return [];
    return [
      {
        site,
        version: sessionItemVersion(row),
        open: async () =>
          SessionSiteCookies.parse(
            JSON.parse(await openVaultValue(deps.prisma, deps.secretStore, row)),
          ),
      },
    ];
  });
}

function batches(sites: SiteSession[]): SiteSession[][] {
  const out: SiteSession[][] = [];
  let current: SiteSession[] = [];
  let size = 0;
  for (const site of sites) {
    const bytes = Buffer.byteLength(JSON.stringify(site));
    const full = current.length >= SESSION_SITES_PER_REQUEST || size + bytes > MAX_BATCH_BYTES;
    if (current.length && full) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(site);
    size += bytes;
  }
  if (current.length || !out.length) out.push(current);
  return out;
}

const SYNC_TRANSACTION_MS = 120_000;

export function syncBotBrowserSessions(
  deps: SessionSyncDeps,
  botId: string,
  context: Pick<AdapterContext, "operationId" | "traceId" | "signal">,
): Promise<SessionDelivery> {
  return deps.prisma.$transaction(
    async (tx) => {
      await advisoryLock(tx, "browser_session_sync", botId);
      return syncBotBrowserSessionsOnce(deps, botId, context);
    },
    { timeout: SYNC_TRANSACTION_MS },
  );
}

async function failedSync(deps: SessionSyncDeps, spaceId: string): Promise<"failed"> {
  await deps.events?.publishSpaceChange?.(spaceId, "vault");
  return "failed";
}

async function syncBotBrowserSessionsOnce(
  deps: SessionSyncDeps,
  botId: string,
  context: Pick<AdapterContext, "operationId" | "traceId" | "signal">,
): Promise<SessionDelivery> {
  const bot = await runAsSystem("browser session sync owner", () =>
    deps.prisma.bot.findUnique({
      where: { id: botId },
      select: { id: true, userId: true, spaceId: true, computer: true },
    }),
  );
  if (!bot) return "failed";
  return runAsTenant({ spaceId: bot.spaceId, userId: bot.userId }, async () => {
    const [desired, applied] = await Promise.all([
      desiredSites(deps, bot),
      deps.prisma.browserSessionSite.findMany({ where: { botId: bot.id } }),
    ]);
    const appliedVersion = new Map(applied.map((row) => [row.site, row.itemVersion]));
    const toSet = desired.filter((entry) => appliedVersion.get(entry.site) !== entry.version);
    const keep = new Set(desired.map((entry) => entry.site));
    const toClear = applied.map((row) => row.site).filter((site) => !keep.has(site));
    if (!toSet.length && !toClear.length) return "signed_in";
    const computer = bot.computer;
    if (await onThisComputer(deps.prisma, computer)) return failedSync(deps, bot.spaceId);
    if (computer?.state !== "running" || !computer.providerRef) {
      await deps.events?.publishSpaceChange?.(bot.spaceId, "vault");
      return "next_start";
    }
    if (!deps.sandbox.pageBrowser) return failedSync(deps, bot.spaceId);
    const sites = await Promise.all(
      toSet.map(async (entry) => ({ site: entry.site, cookies: await entry.open() })),
    );
    const adapterContext: AdapterContext = {
      ...context,
      userId: bot.userId,
      spaceId: bot.spaceId,
      botId: bot.id,
    };
    const ref = toComputerRef(computer);
    const groups = batches(sites.filter((entry) => entry.cookies.length > 0));
    for (const [index, group] of groups.entries()) {
      const result = await deps.sandbox.pageBrowser(
        ref,
        {
          command: "sessions",
          sites: group,
          clear: index === groups.length - 1 ? toClear : [],
        },
        adapterContext,
      );
      if (!result.ok) {
        getLogger().warn("browser_sessions.sync_failed", {
          "bot.id": bot.id,
          sites: group.length,
          cleared: toClear.length,
          error: typeof result.error === "string" ? result.error : undefined,
        });
        return failedSync(deps, bot.spaceId);
      }
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.browserSessionSite.deleteMany({
        where: { botId: bot.id, site: { in: [...toClear, ...toSet.map((entry) => entry.site)] } },
      });
      await tx.browserSessionSite.createMany({
        data: toSet.map((entry) => ({
          botId: bot.id,
          userId: bot.userId,
          spaceId: bot.spaceId,
          site: entry.site,
          itemVersion: entry.version,
        })),
        skipDuplicates: true,
      });
    });
    if (toSet.length || toClear.length)
      await deps.events?.publishSpaceChange?.(bot.spaceId, "vault");
    getLogger().info("browser_sessions.synced", {
      "bot.id": bot.id,
      set: toSet.length,
      cleared: toClear.length,
    });
    return "signed_in";
  });
}

export async function syncComputerBrowserSessions(
  deps: SessionSyncDeps,
  computerId: string,
  context: Pick<AdapterContext, "operationId" | "traceId" | "signal">,
): Promise<void> {
  const bots = await runAsSystem("browser session sync on boot", () =>
    deps.prisma.bot.findMany({
      where: {
        computerId,
        OR: [
          { browserSessionSites: { some: {} } },
          { vaultCredentials: { some: { credential: { auth: SESSION_TYPE } } } },
        ],
      },
      select: { id: true },
    }),
  );
  for (const bot of bots) await syncBotBrowserSessions(deps, bot.id, context);
}
