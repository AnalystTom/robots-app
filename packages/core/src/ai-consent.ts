import type { AiConsentStatus, AiDataUse, AiRecipient, SettingsScope } from "@robots/contracts";
import { AI_CONSENT_REQUIRED, SettingsScopeSchema } from "@robots/contracts";

export class AiConsentBlocked extends Error {
  constructor(message = AI_CONSENT_REQUIRED, cause?: unknown) {
    super(message);
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, writable: true, configurable: true });
    }
  }
}

const pendingAiConsent = new Map<string, { done: Promise<void>; keys: string[] }>();

export function aiDataUsesForProcedure(procedure: string, input?: unknown): AiDataUse[] {
  const path = procedure.replaceAll(".", "/");
  if (
    path === "routines/update" &&
    input &&
    typeof input === "object" &&
    "active" in input &&
    input.active === false
  )
    return [];
  if (
    [
      "threads/send",
      "threads/sendWithRoutines",
      "artifacts/create",
      "threads/followUp",
      "threads/react",
      "threads/answer",
      "routines/create",
      "routines/update",
      "routines/testRun",
    ].includes(path)
  )
    return ["model", "memory"];
  if (["voice/prepare", "voice/speak", "voice/transcribe"].includes(path)) return ["voice"];
  return [];
}

export async function ensureAiDataConsent(options: {
  uses: AiDataUse[];
  status(): Promise<AiConsentStatus>;
  prompt(
    recipients: AiRecipient[],
    privacyUrl: string | undefined,
    grant: () => Promise<unknown>,
  ): Promise<boolean>;
  allow(input: { scope: string; version: string; keys: string[] }): Promise<unknown>;
  coalesceKey?: string;
}) {
  if (options.uses.length === 0) return;
  const granted = new Set<string>();
  try {
    for (;;) {
      const status = await options.status();
      const needed = status.recipients.filter(
        (recipient) =>
          !recipient.allowed && options.uses.includes(recipient.use) && !granted.has(recipient.key),
      );
      if (needed.length === 0) return;
      const key = [options.coalesceKey ?? "", status.scope, status.version].join("\u0000");
      const shown = pendingAiConsent.get(key);
      if (shown) {
        await shown.done;
        for (const grantedKey of shown.keys) granted.add(grantedKey);
        if (needed.every((recipient) => granted.has(recipient.key))) return;
        continue;
      }
      const keys = needed.map((recipient) => recipient.key);
      const grant = () => options.allow({ scope: status.scope, version: status.version, keys });
      const done = (async () => {
        if (!(await options.prompt(needed, status.privacyUrl, grant)))
          throw new Error(AI_CONSENT_REQUIRED);
        await grant();
      })().finally(() => {
        if (pendingAiConsent.get(key)?.done === done) pendingAiConsent.delete(key);
      });
      pendingAiConsent.set(key, { done, keys });
      await done;
      return;
    }
  } catch (error) {
    throw new AiConsentBlocked(error instanceof Error ? error.message : AI_CONSENT_REQUIRED, error);
  }
}

export function aiConsentTarget(input: unknown): {
  botId?: string;
  groupId?: string;
  routineId?: string;
  settingsScope?: SettingsScope;
} {
  if (!input || typeof input !== "object") return {};
  const scope = SettingsScopeSchema.safeParse((input as { scope?: unknown }).scope).data;
  const thread = threadConsentTarget(input);
  return scope ? { ...thread, settingsScope: scope } : thread;
}

export function aiConsentTargets(input: unknown): ReturnType<typeof aiConsentTarget>[] {
  const routineIds = (input as { routineIds?: unknown } | null | undefined)?.routineIds;
  return [
    aiConsentTarget(input),
    ...(Array.isArray(routineIds) ? routineIds : [])
      .filter((routineId): routineId is string => typeof routineId === "string")
      .map((routineId) => ({ routineId })),
  ];
}

function threadConsentTarget(input: object): {
  botId?: string;
  groupId?: string;
  routineId?: string;
} {
  const target = input as { botId?: unknown; groupId?: unknown; routineId?: unknown };
  const routineId = typeof target.routineId === "string" ? target.routineId : undefined;
  if (typeof target.groupId === "string") {
    return routineId ? { groupId: target.groupId, routineId } : { groupId: target.groupId };
  }
  if (typeof target.botId === "string") {
    return routineId ? { botId: target.botId, routineId } : { botId: target.botId };
  }
  return routineId ? { routineId } : {};
}
