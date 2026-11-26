import type { ProfileSessionsReader } from "@robots/adapters/browser-profile-sessions";
import { BrowserSessionsError } from "@robots/adapters/browser-profile-sessions";
import type { BrowserProfileSummary, BrowserSessionsReadResult } from "@robots/contracts";
import { SESSION_SITES_PER_IMPORT, SessionSite } from "@robots/contracts";
import type { IpcMainInvokeEvent } from "electron";
import type { AppTarget } from "./app-frame.js";
import { fromAppFrame } from "./app-frame.js";

type InvokeEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;

function validSites(sites: unknown): string[] | undefined {
  if (!Array.isArray(sites) || sites.length === 0 || sites.length > SESSION_SITES_PER_IMPORT) {
    return undefined;
  }
  return sites.every((site) => SessionSite.safeParse(site).success)
    ? (sites as string[])
    : undefined;
}

export type ConfirmSessionListing = (server: string) => Promise<boolean>;

export type ConfirmSessionImport = (request: {
  server: string;
  profile: BrowserProfileSummary;
  sites: readonly string[];
}) => Promise<boolean>;

export function createBrowserSessionsHandlers(
  getTarget: () => AppTarget | null,
  reader: ProfileSessionsReader,
  confirmListing: ConfirmSessionListing,
  confirm: ConfirmSessionImport,
) {
  return {
    profiles: async (event: InvokeEvent): Promise<BrowserProfileSummary[] | null> => {
      const target = getTarget();
      if (!target || !fromAppFrame(target, event)) return null;
      if (!(await confirmListing(new URL(target.url).host))) return null;
      return reader.profiles();
    },

    read: async (
      event: InvokeEvent,
      profileId: unknown,
      sites: unknown,
    ): Promise<BrowserSessionsReadResult | null> => {
      const wanted = validSites(sites);
      const target = getTarget();
      if (!target || !fromAppFrame(target, event) || typeof profileId !== "string" || !wanted) {
        return null;
      }
      try {
        const profile = (await reader.profiles()).find((entry) => entry.id === profileId);
        if (!profile)
          throw new BrowserSessionsError("profile_not_found", "That browser profile is gone.");
        const server = new URL(target.url).host;
        if (!(await confirm({ server, profile, sites: wanted }))) {
          return { ok: false, code: "cancelled", error: "The import was cancelled." };
        }
        return { ok: true, sessions: await reader.read(profileId, wanted) };
      } catch (error) {
        if (error instanceof BrowserSessionsError) {
          return { ok: false, code: error.code, error: error.message };
        }
        throw error;
      }
    },
  };
}
