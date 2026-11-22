import { randomUUID } from "node:crypto";
import type { SessionVaultScope } from "@robots/adapters";
import { importBrowserSessions, sessionItemBots, syncBotBrowserSessions } from "@robots/adapters";
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

const SIGN_OUT_ATTEMPTS = 4;

export async function importSessions(
  deps: SessionDeps,
  scope: SessionVaultScope,
  input: ImportSessionsInput,
): Promise<ImportSessionsResult> {
  const sites = await importBrowserSessions(
    { prisma: deps.prisma, secretStore: deps.secrets },
    scope,
    input,
  );
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
  syncSessionBots(deps, input.botIds);
  return { sites, bots: input.botIds.map((botId) => ({ botId, delivery: "pending" as const })) };
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
