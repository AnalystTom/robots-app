import { spawn } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bestEffort } from "@robots/logging";

const BROWSERS = [
  { id: "chrome", label: "Chrome", dir: ".config/google-chrome", keyringApplication: "chrome" },
  { id: "chromium", label: "Chromium", dir: ".config/chromium", keyringApplication: "chromium" },
] as const;

const PUBLIC_PASSWORD = "peanuts";
const MIN_DB_VERSION = 24;
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const KEYRING_TIMEOUT_MS = 5_000;

export class HostBrowserCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostBrowserCookieError";
  }
}

export interface HostKeyring {
  passwords(application: string): Promise<string[]>;
}

export interface HostBrowserCookie {
  name: string;
  value: string;
  path: string;
  domain?: string;
  url?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "None" | "Lax" | "Strict";
  expires?: number;
  priority?: "Low" | "Medium" | "High";
  sourceScheme?: "Unset" | "NonSecure" | "Secure";
}

export interface CookieRow {
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
  priority: number | bigint;
  source_scheme: number | bigint;
  top_frame_site_key: string;
}

export interface CookieKeys {
  v10: Buffer;
  v11?: Buffer[];
}

const SITE_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function isSiteName(value: string) {
  return SITE_NAME.test(value);
}

export function normalizeSite(site: string) {
  const normalized = site.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
  if (!isSiteName(normalized)) throw new HostBrowserCookieError(`"${site}" is not a site name`);
  return normalized;
}

export function cookieBelongsToSite(hostKey: string, site: string) {
  const host = hostKey.toLowerCase().replace(/^\./, "");
  return host === site || host.endsWith(`.${site}`);
}

export function siteNames(hostKeys: Iterable<string>) {
  const hosts = [...new Set([...hostKeys].map((key) => key.toLowerCase().replace(/^\./, "")))]
    .filter(isSiteName)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const sites: string[] = [];
  for (const host of hosts) {
    if (!sites.some((site) => cookieBelongsToSite(host, site))) sites.push(host);
  }
  return sites.sort();
}

export function cookieKey(password: string) {
  return pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
}

export function decryptCookieValue(row: CookieRow, keys: CookieKeys): string {
  const encrypted = Buffer.from(row.encrypted_value);
  if (encrypted.length === 0) return row.value;
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  const candidates =
    prefix === "v10" ? [keys.v10] : prefix === "v11" ? (keys.v11 ?? []) : undefined;
  if (!candidates)
    throw new HostBrowserCookieError("This browser stores sign-ins in a way RoBots cannot read");
  if (candidates.length === 0) throw new HostBrowserCookieError("Unlock this computer's keyring");
  for (const key of candidates) {
    const plain = decryptWith(key, encrypted.subarray(3));
    if (!plain) continue;
    const hostHash = createHash("sha256").update(row.host_key).digest();
    if (plain.length >= 32 && plain.subarray(0, 32).equals(hostHash))
      return plain.subarray(32).toString("utf8");
  }
  throw new HostBrowserCookieError("A sign-in could not be decrypted with this computer's key");
}

function decryptWith(key: Buffer, ciphertext: Buffer) {
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return undefined;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return undefined;
  }
}

const SAME_SITE = { 0: "None", 1: "Lax", 2: "Strict" } as const;
const PRIORITY = { 0: "Low", 1: "Medium", 2: "High" } as const;
const SOURCE_SCHEME = { 0: "Unset", 1: "NonSecure", 2: "Secure" } as const;

export function toBrowserCookie(
  row: CookieRow,
  value: string,
  nowSeconds: number,
): HostBrowserCookie | undefined {
  if (row.top_frame_site_key) return undefined;
  const persistent = Number(row.is_persistent) === 1;
  const expires = persistent
    ? Number(BigInt(row.expires_utc) / 1_000_000n) - CHROME_EPOCH_OFFSET_SECONDS
    : undefined;
  if (expires !== undefined && expires <= nowSeconds) return undefined;
  const secure = Number(row.is_secure) === 1;
  const sameSite = SAME_SITE[Number(row.samesite) as keyof typeof SAME_SITE];
  const priority = PRIORITY[Number(row.priority) as keyof typeof PRIORITY];
  const sourceScheme = SOURCE_SCHEME[Number(row.source_scheme) as keyof typeof SOURCE_SCHEME];
  return {
    name: row.name,
    value,
    path: row.path || "/",
    ...(row.host_key.startsWith(".")
      ? { domain: row.host_key }
      : { url: `${secure ? "https" : "http"}://${row.host_key}${row.path || "/"}` }),
    secure,
    httpOnly: Number(row.is_httponly) === 1,
    ...(sameSite ? { sameSite } : {}),
    ...(expires !== undefined ? { expires } : {}),
    ...(priority ? { priority } : {}),
    ...(sourceScheme ? { sourceScheme } : {}),
  };
}

export function secretToolKeyring(timeoutMs = KEYRING_TIMEOUT_MS): HostKeyring {
  return {
    passwords: (application) =>
      new Promise((resolve, reject) => {
        const child = spawn("secret-tool", ["search", "--all", "application", application], {
          stdio: ["ignore", "pipe", "ignore"],
          signal: AbortSignal.timeout(timeoutMs),
        });
        const chunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.once("error", () =>
          reject(new HostBrowserCookieError("Unlock this computer's keyring and try again")),
        );
        child.once("close", () => resolve(keyringSecrets(Buffer.concat(chunks).toString("utf8"))));
      }),
  };
}

function keyringSecrets(listing: string) {
  const items = listing.split(/^\[/m).map((item) => ({
    secret: item.match(/^secret = (.*)$/m)?.[1],
    current: /^schema = .*_v2$/m.test(item),
  }));
  return items
    .sort((a, b) => Number(b.current) - Number(a.current))
    .flatMap((item) => (item.secret ? [item.secret] : []));
}

interface BrowserProfileDir {
  id: string;
  name: string;
  cookies: string;
  keyringApplication: string;
}

async function profileDirs(home: string): Promise<BrowserProfileDir[]> {
  const found: BrowserProfileDir[] = [];
  for (const browser of BROWSERS) {
    const root = path.join(home, browser.dir);
    const state = await ifPresent(readFile(path.join(root, "Local State"), "utf8"));
    if (!state) continue;
    let cache: Record<string, { name?: unknown }> = {};
    try {
      cache = JSON.parse(state)?.profile?.info_cache ?? {};
    } catch {
      continue;
    }
    for (const [dir, info] of Object.entries(cache)) {
      if (!/^[A-Za-z0-9 _-]+$/.test(dir)) continue;
      const cookies = await firstFile([
        path.join(root, dir, "Network", "Cookies"),
        path.join(root, dir, "Cookies"),
      ]);
      if (!cookies) continue;
      const label = typeof info?.name === "string" && info.name.trim() ? info.name.trim() : dir;
      found.push({
        id: `${browser.id}:${dir}`,
        name: `${label} (${browser.label})`,
        cookies,
        keyringApplication: browser.keyringApplication,
      });
    }
  }
  return found;
}

async function firstFile(candidates: string[]) {
  for (const candidate of candidates) {
    if ((await ifPresent(stat(candidate)))?.isFile()) return candidate;
  }
  return undefined;
}

async function ifPresent<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function withCookieSnapshot<T>(cookies: string, read: (db: DatabaseSync) => T) {
  const dir = await mkdtemp(path.join(tmpdir(), "robots-cookies-"));
  try {
    const copy = path.join(dir, "Cookies");
    await copyFile(cookies, copy);
    for (const suffix of ["-wal", "-journal"])
      await ifPresent(copyFile(`${cookies}${suffix}`, `${copy}${suffix}`));
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function requireCurrentDbVersion(db: DatabaseSync) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
    | { value?: unknown }
    | undefined;
  const version = Number(row?.value);
  if (!Number.isInteger(version) || version < MIN_DB_VERSION)
    throw new HostBrowserCookieError("This browser profile is too old to import from");
}

function cookieRows(db: DatabaseSync) {
  const statement = db.prepare(
    "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, is_persistent, samesite, priority, source_scheme, top_frame_site_key FROM cookies",
  );
  statement.setReadBigInts(true);
  return statement.all() as unknown as CookieRow[];
}

export async function listHostBrowserProfiles(home: string) {
  const profiles = [];
  for (const profile of await profileDirs(home)) {
    const hostKeys = await bestEffort(
      "read a host browser profile's sites",
      withCookieSnapshot(profile.cookies, (db) =>
        (
          db.prepare("SELECT DISTINCT host_key FROM cookies").all() as Array<{ host_key: string }>
        ).map((row) => row.host_key),
      ),
    );
    if (hostKeys) profiles.push({ id: profile.id, name: profile.name, sites: siteNames(hostKeys) });
  }
  return profiles;
}

export async function readHostBrowserCookies(
  home: string,
  profileId: string,
  requestedSites: string[],
  keyring: HostKeyring,
  now = Date.now(),
) {
  const profile = (await profileDirs(home)).find((candidate) => candidate.id === profileId);
  if (!profile) throw new HostBrowserCookieError("That browser profile is not on this computer");
  const sites = [...new Set(requestedSites.map(normalizeSite))];
  const rows = await withCookieSnapshot(profile.cookies, (db) => {
    requireCurrentDbVersion(db);
    return cookieRows(db);
  });
  const chosen = rows.filter((row) =>
    sites.some((site) => cookieBelongsToSite(row.host_key, site)),
  );
  const needsKeyring = chosen.some(
    (row) => Buffer.from(row.encrypted_value).subarray(0, 3).toString("latin1") === "v11",
  );
  const keys: CookieKeys = {
    v10: cookieKey(PUBLIC_PASSWORD),
    v11: needsKeyring
      ? (await keyring.passwords(profile.keyringApplication)).map(cookieKey)
      : undefined,
  };
  const nowSeconds = Math.floor(now / 1000);
  return sites.map((site) => ({
    site,
    cookies: chosen
      .filter((row) => cookieBelongsToSite(row.host_key, site))
      .flatMap((row) => {
        const cookie = toBrowserCookie(row, decryptCookieValue(row, keys), nowSeconds);
        return cookie ? [cookie] : [];
      }),
  }));
}

export async function savedCookieNames(userDataDir: string) {
  const cookies = await firstFile([
    path.join(userDataDir, "Default", "Network", "Cookies"),
    path.join(userDataDir, "Default", "Cookies"),
  ]);
  if (!cookies) return new Set<string>();
  return withCookieSnapshot(
    cookies,
    (db) =>
      new Set(
        (
          db.prepare("SELECT host_key, name FROM cookies").all() as Array<{
            host_key: string;
            name: string;
          }>
        ).map((row) => cookieIdentity(row.host_key, row.name)),
      ),
  );
}

export function cookieIdentity(hostKey: string, name: string) {
  return `${hostKey}\t${name}`;
}

export function importedCookieIdentity(cookie: HostBrowserCookie) {
  return cookieIdentity(
    cookie.domain ?? new URL(cookie.url ?? "http://invalid").hostname,
    cookie.name,
  );
}
