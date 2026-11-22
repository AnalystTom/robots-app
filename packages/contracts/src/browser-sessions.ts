import { z } from "zod";
import { Id } from "./ids.js";
import { settingsScopeInput } from "./settings-scope.js";

export const SESSION_SITES_PER_IMPORT = 50;
export const SESSION_BOTS_PER_IMPORT = 20;
export const SESSION_SITES_PER_REQUEST = 50;

const SITE_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const SessionSite = z.string().regex(SITE_PATTERN);

function bareHost(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

export function cookieBelongsToSite(domain: string, site: string): boolean {
  const host = bareHost(domain);
  const wanted = site.toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`);
}

export function sessionSiteOrigin(site: string): string {
  return `https://${site}`;
}

export function sessionOriginSite(origin: string): string | undefined {
  if (!URL.canParse(origin)) return undefined;
  const url = new URL(origin);
  return url.protocol === "https:" && SessionSite.safeParse(url.hostname).success
    ? url.hostname
    : undefined;
}

export const SessionCookie = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(4096),
  domain: z.string().min(1).max(253),
  hostOnly: z.boolean(),
  path: z.string().min(1).max(1024).startsWith("/"),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  expires: z.number().int().positive().optional(),
});
export type SessionCookie = z.infer<typeof SessionCookie>;

export const SiteSession = z
  .object({
    site: SessionSite,
    cookies: z.array(SessionCookie).min(1),
  })
  .refine(
    (session) =>
      session.cookies.every((cookie) => cookieBelongsToSite(cookie.domain, session.site)),
    "A cookie belongs to another site",
  );
export type SiteSession = z.infer<typeof SiteSession>;

export const SessionSiteCookies = z.array(SessionCookie);

export const ImportSessionsInput = settingsScopeInput.extend({
  source: z.string().trim().min(1).max(120),
  botIds: z.array(Id).min(1).max(SESSION_BOTS_PER_IMPORT),
  sessions: z
    .array(SiteSession)
    .min(1)
    .max(SESSION_SITES_PER_IMPORT)
    .refine(
      (sessions) => new Set(sessions.map((session) => session.site)).size === sessions.length,
      "Each site once",
    ),
});
export type ImportSessionsInput = z.infer<typeof ImportSessionsInput>;

export const SessionDelivery = z.enum(["pending", "signed_in", "next_start", "failed"]);
export type SessionDelivery = z.infer<typeof SessionDelivery>;

export const ImportSessionsResult = z.object({
  sites: z.array(SessionSite),
  bots: z.array(z.object({ botId: Id, delivery: SessionDelivery })),
});
export type ImportSessionsResult = z.infer<typeof ImportSessionsResult>;

export interface BrowserProfileSite {
  site: string;
  cookies: number;
}

export interface BrowserProfileSummary {
  id: string;
  name: string;
  browser: string;
  busy?: boolean;
  sites: BrowserProfileSite[];
}

export type BrowserSessionsReadResult =
  | { ok: true; sessions: SiteSession[] }
  | { ok: false; code: string; error: string };
