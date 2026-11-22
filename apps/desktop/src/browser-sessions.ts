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

export function createBrowserSessionsHandlers(
  getTarget: () => AppTarget | null,
  reader: ProfileSessionsReader,
) {
  return {
    profiles: async (event: InvokeEvent): Promise<BrowserProfileSummary[] | null> =>
      fromAppFrame(getTarget(), event) ? reader.profiles() : null,

    read: async (
      event: InvokeEvent,
      profileId: unknown,
      sites: unknown,
    ): Promise<BrowserSessionsReadResult | null> => {
      const wanted = validSites(sites);
      if (!fromAppFrame(getTarget(), event) || typeof profileId !== "string" || !wanted) {
        return null;
      }
      try {
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
