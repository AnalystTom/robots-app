import type { MacAppId, MacGrantId, MacGrantState, MacGrantStatus } from "@robots/contracts";
import { MAC_GRANT_IDS, MAC_GRANTS } from "@robots/contracts";
import { MAC_APP_BUNDLES } from "./mac-apps-scripts.js";

export const AE_NOT_PERMITTED = -1743;
export const AE_WOULD_REQUIRE_CONSENT = -1744;
export const AE_TARGET_NOT_RUNNING = -600;

export type AutomationTarget = Exclude<MacAppId, "location">;

export const AUTOMATION_GRANTS: Record<
  Extract<MacGrantId, `automation-${string}`>,
  AutomationTarget
> = {
  "automation-mail": "mail",
  "automation-messages": "messages",
  "automation-notes": "notes",
  "automation-reminders": "reminders",
  "automation-calendar": "calendar",
  "automation-contacts": "contacts",
};

export function automationStatusFromCode(code: number | null): MacGrantStatus | null {
  if (code === 0) return "granted";
  if (code === AE_NOT_PERMITTED) return "denied";
  if (code === AE_WOULD_REQUIRE_CONSENT) return "not-determined";
  return null;
}

export function locationStatusFromCode(probe: {
  enabled: boolean;
  status: number;
}): MacGrantStatus {
  if (!probe.enabled) return "unavailable";
  if (probe.status === 3 || probe.status === 4) return "granted";
  if (probe.status === 1 || probe.status === 2) return "denied";
  return "not-determined";
}

export function fileAccessStatus(code: string | undefined): MacGrantStatus {
  if (code === undefined) return "granted";
  if (code === "EPERM" || code === "EACCES") return "denied";
  if (code === "ENOENT") return "unavailable";
  return "denied";
}

export interface MacPermissionProbes {
  automation(bundleId: string): Promise<number | null>;
  promptAutomation(bundleId: string): Promise<unknown>;
  location(): Promise<{ enabled: boolean; status: number }>;
  promptLocation(): Promise<unknown>;
  messagesDatabase(): Promise<string | undefined>;
  openSettings(url: string): Promise<void>;
}

function isAutomationGrant(grant: MacGrantId): grant is keyof typeof AUTOMATION_GRANTS {
  return grant in AUTOMATION_GRANTS;
}

export function createMacPermissions(probes: MacPermissionProbes) {
  const known = new Map<MacGrantId, MacGrantStatus>();

  async function status(grant: MacGrantId): Promise<MacGrantStatus> {
    if (isAutomationGrant(grant)) {
      const code = await probes
        .automation(MAC_APP_BUNDLES[AUTOMATION_GRANTS[grant]])
        .catch(() => null);
      const mapped = automationStatusFromCode(code);
      if (mapped) known.set(grant, mapped);
      return mapped ?? known.get(grant) ?? "not-determined";
    }
    if (grant === "location")
      return locationStatusFromCode(
        await probes.location().catch(() => ({ enabled: true, status: 0 })),
      );
    return fileAccessStatus(await probes.messagesDatabase());
  }

  async function states(): Promise<MacGrantState[]> {
    return Promise.all(
      MAC_GRANT_IDS.map(async (grant) => ({ grant, status: await status(grant) })),
    );
  }

  return {
    states,
    status,
    remember(grant: MacGrantId, value: MacGrantStatus) {
      known.set(grant, value);
    },
    async allow(grant: MacGrantId): Promise<MacGrantState[]> {
      const before = await status(grant);
      if (before === "not-determined" && isAutomationGrant(grant))
        await probes
          .promptAutomation(MAC_APP_BUNDLES[AUTOMATION_GRANTS[grant]])
          .catch((error: unknown) => {
            if (automationErrorCode(error) === AE_NOT_PERMITTED) known.set(grant, "denied");
          });
      if (before === "not-determined" && grant === "location") await probes.promptLocation();
      if ((await status(grant)) !== "granted")
        await probes.openSettings(MAC_GRANTS[grant].settingsUrl);
      return states();
    },
  };
}

export function automationErrorCode(error: unknown): number | null {
  const text =
    error instanceof Error
      ? `${error.message}\n${(error as { stderr?: unknown }).stderr ?? ""}`
      : String(error);
  const match = /\((-\d+)\)\s*$/m.exec(text);
  return match ? Number(match[1]) : null;
}

export type MacPermissions = ReturnType<typeof createMacPermissions>;
