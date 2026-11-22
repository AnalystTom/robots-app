import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { SessionVaultScope } from "@robots/adapters";
import {
  importBrowserSessions,
  SESSION_IMPORT_TOO_LARGE,
  SESSIONS_NEED_OWN_SPACE,
  SESSIONS_NOT_ON_THIS_COMPUTER,
  sessionItemBots,
  syncBotBrowserSessions,
  UNKNOWN_BOTS,
} from "@robots/adapters";
import type { ImportSessionsInput, ImportSessionsResult } from "@robots/contracts";
import { retry } from "@robots/core";
import { recordSecurityEvent } from "@robots/db";
import { bestEffort } from "@robots/logging";
import type { RouterDeps } from "./router.js";

type SessionDeps = Pick<RouterDeps, "prisma" | "secrets" | "sandbox" | "events">;

function syncDeps(deps: SessionDeps) {
  return {
    prisma: deps.prisma,
    secretStore: deps.secrets,
    sandbox: deps.sandbox,
    events: deps.events,
  };
}

function syncContext() {
  const id = randomUUID();
  return { operationId: id, traceId: id, signal: new AbortController().signal };
}

const REFUSALS = [
  SESSIONS_NEED_OWN_SPACE,
  SESSION_IMPORT_TOO_LARGE,
  SESSIONS_NOT_ON_THIS_COMPUTER,
  UNKNOWN_BOTS,
];
const SIGN_OUT_ATTEMPTS = 4;

export async function importSessions(
  deps: SessionDeps,
  scope: SessionVaultScope,
  input: ImportSessionsInput,
): Promise<ImportSessionsResult> {
  let sites: string[];
  try {
    sites = await importBrowserSessions(
      { prisma: deps.prisma, secretStore: deps.secrets },
      scope,
      input,
    );
  } catch (error) {
    if (error instanceof Error && REFUSALS.includes(error.message)) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    if (error instanceof Error && error.message === "Credential limit reached") {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
  await recordSecurityEvent({
    type: "credential.created",
    userId: scope.userId,
    spaceId: scope.spaceId,
    metadata: {
      procedure: "vault.importSessions",
      kind: "vault_credential",
      scope: scope.vault ?? null,
      sites: sites.join(","),
      siteCount: sites.length,
      cookieCount: input.sessions.reduce((sum, session) => sum + session.cookies.length, 0),
      botCount: input.botIds.length,
    },
  });
  const bots = [];
  for (const botId of input.botIds) {
    bots.push({
      botId,
      delivery: await syncBotBrowserSessions(syncDeps(deps), botId, syncContext()),
    });
  }
  return { sites, bots };
}

export function removedSessionBots(
  deps: Pick<RouterDeps, "prisma">,
  scope: SessionVaultScope,
  name: string,
): Promise<string[]> {
  return sessionItemBots(deps.prisma, scope, name);
}

export function syncSessionBots(deps: SessionDeps, botIds: readonly string[]): void {
  for (const botId of new Set(botIds)) {
    void bestEffort(
      "sync a sign-in item to its bot's browser",
      retry(
        async () => {
          if ((await syncBotBrowserSessions(syncDeps(deps), botId, syncContext())) === "failed") {
            throw new Error("The bot's browser did not take the sign-in change.");
          }
        },
        { attempts: SIGN_OUT_ATTEMPTS, retryable: () => true },
      ),
    );
  }
}
