import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserProfileSummary, SessionCookie, SiteSession } from "@robots/contracts";
import { cookieBelongsToSite } from "@robots/contracts";
import { hostSite } from "@robots/core/egress";
import type { CookieKeys } from "./browser-cookie-crypto.js";
import {
  BrowserSessionsError,
  cookieCipherVersion,
  decryptCookie,
  isKnownCipherVersion,
  unsupportedEncryption,
} from "./browser-cookie-crypto.js";
import type { BrowserKeySource } from "./browser-cookie-keys.js";

export { BrowserSessionsError } from "./browser-cookie-crypto.js";
export { platformKeySource } from "./browser-cookie-keys.js";

export interface BrowserFamily {
  id: string;
  label: string;
  dirs: Partial<Record<NodeJS.Platform, readonly string[]>>;
  keyName: Partial<Record<NodeJS.Platform, string>>;
  keyringApplications: readonly string[];
}

export const BROWSER_FAMILIES: readonly BrowserFamily[] = [
  {
    id: "chrome",
    label: "Chrome",
    dirs: {
      linux: ["$CONFIG/google-chrome", "$HOME/.var/app/com.google.Chrome/config/google-chrome"],
      darwin: ["$HOME/Library/Application Support/Google/Chrome"],
      win32: ["$LOCALAPPDATA/Google/Chrome/User Data"],
    },
    keyName: { darwin: "Chrome" },
    keyringApplications: ["chrome"],
  },
];

export interface BrowserHost {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

interface FoundProfile {
  id: string;
  family: BrowserFamily;
  userDataDir: string;
  directory: string;
  name: string;
  cookiesPath: string;
}

function expandDir(template: string, host: BrowserHost): string | undefined {
  const config = host.env.XDG_CONFIG_HOME || join(host.home, ".config");
  const localAppData = host.env.LOCALAPPDATA || join(host.home, "AppData", "Local");
  const expanded = template
    .replace("$CONFIG", config)
    .replace("$LOCALAPPDATA", localAppData)
    .replace("$HOME", host.home);
  return expanded.includes("$") ? undefined : expanded;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function profileNames(localState: unknown): Array<{ directory: string; name: string }> {
  const cache = (localState as { profile?: { info_cache?: unknown } } | undefined)?.profile
    ?.info_cache;
  if (!cache || typeof cache !== "object") return [];
  return Object.entries(cache as Record<string, unknown>)
    .filter(([directory]) => /^[\w .-]{1,64}$/.test(directory) && !directory.startsWith("."))
    .map(([directory, info]) => {
      const name = (info as { name?: unknown } | null)?.name;
      return { directory, name: typeof name === "string" && name.trim() ? name.trim() : directory };
    });
}

async function cookiesPath(profileDir: string): Promise<string | undefined> {
  for (const candidate of [join(profileDir, "Network", "Cookies"), join(profileDir, "Cookies")]) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function findProfiles(host: BrowserHost): Promise<FoundProfile[]> {
  const found: FoundProfile[] = [];
  for (const family of BROWSER_FAMILIES) {
    const templates = family.dirs[host.platform] ?? [];
    for (const [rootIndex, template] of templates.entries()) {
      const userDataDir = expandDir(template, host);
      if (!userDataDir) continue;
      const localState = await readJson(join(userDataDir, "Local State"));
      for (const { directory, name } of profileNames(localState)) {
        const path = await cookiesPath(join(userDataDir, directory));
        if (!path) continue;
        found.push({
          id: `${family.id}/${rootIndex}/${directory}`,
          family,
          userDataDir,
          directory,
          name,
          cookiesPath: path,
        });
      }
    }
  }
  return found;
}

async function withCookieCopy<T>(cookiesFile: string, read: (db: DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "robots-cookies-"));
  try {
    const copy = join(dir, "Cookies");
    try {
      await copyFile(cookiesFile, copy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BrowserSessionsError("profile_not_found", "That browser profile is gone.");
      }
      throw new BrowserSessionsError(
        "profile_busy",
        "The browser is holding its sign-ins open. Close the browser and try again.",
      );
    }
    for (const suffix of ["-wal", "-journal"]) {
      if (await exists(cookiesFile + suffix)) await copyFile(cookiesFile + suffix, copy + suffix);
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(copy);
      return read(db);
    } catch (error) {
      if (error instanceof BrowserSessionsError) throw error;
      throw new BrowserSessionsError(
        "profile_unreadable",
        "RoBots can't read this browser's sign-ins.",
      );
    } finally {
      db?.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600;

export function chromiumTimeToUnixSeconds(value: number | bigint): number {
  return Number(BigInt(value) / 1_000_000n) - CHROMIUM_EPOCH_OFFSET_SECONDS;
}

interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  path: string;
  expires_utc: number | bigint;
  is_secure: number | bigint;
  is_httponly: number | bigint;
  is_persistent: number | bigint;
  samesite: number | bigint;
  top_frame_site_key: string;
}

function columns(db: DatabaseSync): Set<string> {
  const rows = db.prepare("PRAGMA table_info(cookies)").all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function dbVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
    | { value: string }
    | undefined;
  return Number(row?.value ?? 0);
}

function cookieRows(db: DatabaseSync): CookieRow[] {
  const has = columns(db);
  const pick = (name: string, fallback: string) =>
    has.has(name) ? name : `${fallback} AS ${name}`;
  const statement = db.prepare(
    `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly,
      ${pick("is_persistent", "1")}, ${pick("samesite", "-1")}, ${pick("top_frame_site_key", "''")}
     FROM cookies`,
  );
  statement.setReadBigInts(true);
  return statement.all() as unknown as CookieRow[];
}

function rowSite(row: Pick<CookieRow, "host_key">): string | undefined {
  return hostSite(row.host_key.replace(/^\./, ""));
}

function expired(row: CookieRow, nowSeconds: number): boolean {
  if (!Number(row.is_persistent) || !Number(row.expires_utc)) return false;
  return chromiumTimeToUnixSeconds(row.expires_utc) <= nowSeconds;
}

function usable(row: CookieRow, nowSeconds: number): boolean {
  return !row.top_frame_site_key && !expired(row, nowSeconds) && rowSite(row) !== undefined;
}

const SAME_SITE: Record<number, SessionCookie["sameSite"]> = { 0: "None", 1: "Lax", 2: "Strict" };

function sessionCookie(row: CookieRow, value: string): SessionCookie {
  const hostOnly = !row.host_key.startsWith(".");
  const sameSite = SAME_SITE[Number(row.samesite)];
  const persistent = Number(row.is_persistent) && Number(row.expires_utc);
  return {
    name: row.name,
    value,
    domain: hostOnly ? row.host_key : row.host_key.slice(1),
    hostOnly,
    path: row.path || "/",
    secure: Boolean(Number(row.is_secure)),
    httpOnly: Boolean(Number(row.is_httponly)),
    ...(sameSite ? { sameSite } : {}),
    ...(persistent ? { expires: chromiumTimeToUnixSeconds(row.expires_utc) } : {}),
  };
}

function siteCounts(db: DatabaseSync, nowSeconds: number): Map<string, number> {
  const bySite = new Map<string, number>();
  for (const row of cookieRows(db)) {
    if (!usable(row, nowSeconds)) continue;
    const site = rowSite(row) as string;
    bySite.set(site, (bySite.get(site) ?? 0) + 1);
  }
  return bySite;
}

export interface ProfileSessionsReader {
  profiles(): Promise<BrowserProfileSummary[]>;
  read(profileId: string, sites: readonly string[]): Promise<SiteSession[]>;
}

export function profileSessionsReader(
  host: BrowserHost,
  keys: BrowserKeySource,
  now: () => number = Date.now,
): ProfileSessionsReader {
  return {
    async profiles() {
      const summaries: BrowserProfileSummary[] = [];
      for (const profile of await findProfiles(host)) {
        const nowSeconds = Math.floor(now() / 1000);
        const base = { id: profile.id, name: profile.name, browser: profile.family.label };
        let counts: Map<string, number>;
        try {
          counts = await withCookieCopy(profile.cookiesPath, (db) => siteCounts(db, nowSeconds));
        } catch (error) {
          if (!(error instanceof BrowserSessionsError)) throw error;
          if (error.code === "profile_unreadable") continue;
          if (error.code !== "profile_busy") throw error;
          summaries.push({ ...base, busy: true, sites: [] });
          continue;
        }
        if (!counts.size) continue;
        summaries.push({
          ...base,
          sites: [...counts.entries()]
            .map(([site, cookies]) => ({ site, cookies }))
            .sort((a, b) => a.site.localeCompare(b.site)),
        });
      }
      return summaries;
    },

    async read(profileId, sites) {
      const profile = (await findProfiles(host)).find((candidate) => candidate.id === profileId);
      if (!profile)
        throw new BrowserSessionsError("profile_not_found", "That browser profile is gone.");
      const wanted = [...new Set(sites.map((site) => site.toLowerCase()))];
      const nowSeconds = Math.floor(now() / 1000);
      const { version, rows } = await withCookieCopy(profile.cookiesPath, (db) => ({
        version: dbVersion(db),
        rows: cookieRows(db).filter(
          (row) =>
            usable(row, nowSeconds) &&
            wanted.some((site) => cookieBelongsToSite(row.host_key, site)),
        ),
      }));
      const versions = new Set<string>();
      for (const row of rows) {
        const cipher = cookieCipherVersion(row.encrypted_value);
        if (cipher === undefined) continue;
        if (!isKnownCipherVersion(cipher)) throw unsupportedEncryption(cipher);
        versions.add(cipher);
      }
      let cookieKeys: CookieKeys | undefined;
      const sessions: SiteSession[] = [];
      for (const site of wanted) {
        const cookies: SessionCookie[] = [];
        for (const row of rows) {
          if (!cookieBelongsToSite(row.host_key, site)) continue;
          if (cookieCipherVersion(row.encrypted_value) !== undefined && !cookieKeys) {
            cookieKeys = await keys.cookieKeys(profile.family, profile.userDataDir, versions);
          }
          const value = cookieKeys
            ? decryptCookie(
                {
                  encrypted: row.encrypted_value,
                  plain: row.value,
                  hostKey: row.host_key,
                  dbVersion: version,
                },
                cookieKeys,
              )
            : row.value;
          cookies.push(sessionCookie(row, value));
        }
        if (cookies.length) sessions.push({ site, cookies });
      }
      return sessions;
    },
  };
}
