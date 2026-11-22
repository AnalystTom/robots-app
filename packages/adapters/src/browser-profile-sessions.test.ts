import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cookieBelongsToSite, SiteSession } from "@robots/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CookieCipherVersion, CookieKeys } from "./browser-cookie-crypto.js";
import {
  cbcKey,
  linuxCookieKeys,
  macCookieKeys,
  windowsCookieKeys,
} from "./browser-cookie-crypto.js";
import { encryptCookieForTest } from "./browser-cookie-crypto.test-support.js";
import type { CommandResult, RunCommand } from "./browser-cookie-keys.js";
import { platformKeySource } from "./browser-cookie-keys.js";
import type { BrowserHost } from "./browser-profile-sessions.js";
import { profileSessionsReader } from "./browser-profile-sessions.js";

const NOW_MS = Date.UTC(2026, 10, 22);
const FUTURE = chromiumTime(Date.UTC(2027, 10, 1));
const PAST = chromiumTime(Date.UTC(2026, 0, 1));
const KEYRING_PASSWORD = "fixture-keyring-password";
const KEYCHAIN_PASSWORD = "fixture-keychain-password";
const WINDOWS_KEY = Buffer.alloc(32, 9);

function chromiumTime(ms: number): bigint {
  return (BigInt(ms) / 1000n + 11_644_473_600n) * 1_000_000n;
}

interface FixtureCookie {
  host: string;
  name: string;
  value: string;
  version?: CookieCipherVersion | "v20" | "plain";
  expires?: bigint;
  persistent?: boolean;
  partitioned?: boolean;
  skipHash?: boolean;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "robots-profile-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeProfile(input: {
  userDataDir: string;
  dbVersion: number;
  keys: CookieKeys;
  cookies: FixtureCookie[];
  name?: string;
  localState?: Record<string, unknown>;
}) {
  await mkdir(join(input.userDataDir, "Default", "Network"), { recursive: true });
  await writeFile(
    join(input.userDataDir, "Local State"),
    JSON.stringify({
      profile: { info_cache: { Default: { name: input.name ?? "Thomas" } } },
      ...input.localState,
    }),
  );
  const db = new DatabaseSync(join(input.userDataDir, "Default", "Network", "Cookies"));
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cookies (creation_utc INTEGER, host_key TEXT, top_frame_site_key TEXT, name TEXT,
      value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER,
      is_httponly INTEGER, last_access_utc INTEGER, has_expires INTEGER, is_persistent INTEGER,
      priority INTEGER, samesite INTEGER, source_scheme INTEGER, source_port INTEGER);`);
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(String(input.dbVersion));
  const insert = db.prepare(
    `INSERT INTO cookies VALUES (0, ?, ?, ?, ?, ?, '/', ?, 1, 1, 0, 1, ?, 1, 1, 2, 443)`,
  );
  for (const cookie of input.cookies) {
    const version = cookie.version ?? "v10";
    const encrypted =
      version === "plain"
        ? Buffer.alloc(0)
        : version === "v20"
          ? Buffer.concat([Buffer.from("v20"), Buffer.alloc(40, 1)])
          : encryptCookieForTest(
              cookie.value,
              {
                hostKey: cookie.host,
                dbVersion: cookie.skipHash ? 0 : input.dbVersion,
                version,
              },
              input.keys,
            );
    insert.run(
      cookie.host,
      cookie.partitioned ? "https://embedder.example" : "",
      cookie.name,
      version === "plain" ? cookie.value : "",
      encrypted,
      cookie.expires ?? FUTURE,
      cookie.persistent === false ? 0 : 1,
    );
  }
  db.close();
}

function fakeRun(answers: Record<string, Partial<CommandResult>>): RunCommand & {
  calls: Array<{ file: string; args: readonly string[]; input?: string }>;
} {
  const calls: Array<{ file: string; args: readonly string[]; input?: string }> = [];
  const run = (async (file, args, options) => {
    calls.push({ file, args, input: options.input });
    const answer = answers[`${file} ${args.join(" ")}`] ?? answers[file] ?? { missing: true };
    return { code: 0, stdout: "", missing: false, timedOut: false, ...answer };
  }) as RunCommand & { calls: typeof calls };
  run.calls = calls;
  return run;
}

function linuxHost(): BrowserHost {
  return { platform: "linux", home: root, env: { XDG_CONFIG_HOME: join(root, ".config") } };
}

const linuxV10 = linuxCookieKeys([]);
const linuxV11 = linuxCookieKeys([KEYRING_PASSWORD]);

describe("Chrome profile sessions", () => {
  it("lists sites by registrable domain, leaving out expired and partitioned cookies", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV10,
      cookies: [
        { host: ".x.com", name: "auth_token", value: "a" },
        { host: "api.x.com", name: "ct0", value: "b" },
        { host: ".evilx.com", name: "auth_token", value: "c" },
        { host: ".google.co.uk", name: "NID", value: "d" },
        { host: ".x.com", name: "old", value: "e", expires: PAST },
        { host: ".x.com", name: "chip", value: "f", partitioned: true },
      ],
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    expect(await reader.profiles()).toEqual([
      {
        id: "chrome/0/Default",
        name: "Thomas",
        browser: "Chrome",
        sites: [
          { site: "evilx.com", cookies: 1 },
          { site: "google.co.uk", cookies: 1 },
          { site: "x.com", cookies: 2 },
        ],
      },
    ]);
  });

  it("reads v10 cookies on Linux without asking the keyring, and only the chosen site", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV10,
      cookies: [
        { host: ".x.com", name: "auth_token", value: "token-x" },
        { host: "api.x.com", name: "ct0", value: "csrf-x" },
        { host: ".evilx.com", name: "auth_token", value: "token-evil" },
        { host: ".x.com", name: "gone", value: "expired", expires: PAST },
        { host: ".x.com", name: "session", value: "tab", persistent: false },
      ],
    });
    const run = fakeRun({});
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", run),
      () => NOW_MS,
    );
    const sessions = await reader.read("chrome/0/Default", ["x.com"]);
    expect(run.calls).toEqual([]);
    expect(sessions).toHaveLength(1);
    expect(SiteSession.parse(sessions[0])).toEqual(sessions[0]);
    expect(
      sessions[0]?.cookies.map((cookie) => [cookie.domain, cookie.name, cookie.value]),
    ).toEqual([
      ["x.com", "auth_token", "token-x"],
      ["api.x.com", "ct0", "csrf-x"],
      ["x.com", "session", "tab"],
    ]);
    expect(sessions[0]?.cookies[0]).toMatchObject({
      hostOnly: false,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(Date.UTC(2027, 10, 1) / 1000),
    });
    expect(sessions[0]?.cookies[1]?.hostOnly).toBe(true);
    expect(sessions[0]?.cookies[2]?.expires).toBeUndefined();
  });

  it("decrypts v11 cookies with the keyring password", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV11,
      cookies: [{ host: ".x.com", name: "auth_token", value: "token-v11", version: "v11" }],
    });
    const run = fakeRun({
      "secret-tool lookup application chrome": { stdout: KEYRING_PASSWORD },
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", run),
      () => NOW_MS,
    );
    const [session] = await reader.read("chrome/0/Default", ["x.com"]);
    expect(session?.cookies[0]?.value).toBe("token-v11");
    expect(run.calls.map((call) => call.args.join(" "))).toEqual(["lookup application chrome"]);
  });

  it("reads a database before version 24, which has no host hash", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 23,
      keys: linuxV10,
      cookies: [{ host: ".x.com", name: "auth_token", value: "token-23" }],
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    const [session] = await reader.read("chrome/0/Default", ["x.com"]);
    expect(session?.cookies[0]?.value).toBe("token-23");
  });

  it("refuses a version 24 value whose host hash does not match", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV10,
      cookies: [{ host: ".x.com", name: "auth_token", value: "no-hash", skipHash: true }],
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    await expect(reader.read("chrome/0/Default", ["x.com"])).rejects.toMatchObject({
      code: "wrong_key",
    });
  });

  it("refuses app-bound and unknown prefixes with a clear message", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV10,
      cookies: [{ host: ".x.com", name: "auth_token", value: "", version: "v20" }],
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    await expect(reader.read("chrome/0/Default", ["x.com"])).rejects.toMatchObject({
      code: "unsupported_encryption",
      message: expect.stringContaining("app-bound"),
    });
  });

  it("says the keyring is locked when it does not answer in time", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV11,
      cookies: [{ host: ".x.com", name: "auth_token", value: "v", version: "v11" }],
    });
    const run = fakeRun({ "secret-tool": { code: null, timedOut: true } });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", run),
      () => NOW_MS,
    );
    await expect(reader.read("chrome/0/Default", ["x.com"])).rejects.toMatchObject({
      code: "key_locked",
    });
  });

  it("decrypts macOS cookies with the Keychain password", async () => {
    const userDataDir = join(root, "Library", "Application Support", "Google", "Chrome");
    await writeProfile({
      userDataDir,
      dbVersion: 24,
      keys: macCookieKeys(KEYCHAIN_PASSWORD),
      cookies: [{ host: ".x.com", name: "auth_token", value: "token-mac" }],
    });
    const run = fakeRun({ "/usr/bin/security": { stdout: `${KEYCHAIN_PASSWORD}\n` } });
    const reader = profileSessionsReader(
      { platform: "darwin", home: root, env: {} },
      platformKeySource("darwin", run),
      () => NOW_MS,
    );
    const [session] = await reader.read("chrome/0/Default", ["x.com"]);
    expect(session?.cookies[0]?.value).toBe("token-mac");
    expect(run.calls[0]?.args).toEqual([
      "find-generic-password",
      "-w",
      "-s",
      "Chrome Safe Storage",
      "-a",
      "Chrome",
    ]);
    expect(cbcKey(KEYCHAIN_PASSWORD, 1003)).not.toEqual(cbcKey(KEYCHAIN_PASSWORD, 1));
  });

  it("says Keychain access was denied when the prompt is refused", async () => {
    await writeProfile({
      userDataDir: join(root, "Library", "Application Support", "Google", "Chrome"),
      dbVersion: 24,
      keys: macCookieKeys(KEYCHAIN_PASSWORD),
      cookies: [{ host: ".x.com", name: "auth_token", value: "v" }],
    });
    const run = fakeRun({ "/usr/bin/security": { code: 128 } });
    const reader = profileSessionsReader(
      { platform: "darwin", home: root, env: {} },
      platformKeySource("darwin", run),
      () => NOW_MS,
    );
    await expect(reader.read("chrome/0/Default", ["x.com"])).rejects.toMatchObject({
      code: "key_denied",
    });
  });

  it("decrypts Windows cookies with the DPAPI-unwrapped key", async () => {
    const userDataDir = join(root, "AppData", "Local", "Google", "Chrome", "User Data");
    const wrapped = Buffer.concat([Buffer.from("DPAPI"), Buffer.from("opaque-blob")]);
    await writeProfile({
      userDataDir,
      dbVersion: 24,
      keys: windowsCookieKeys(WINDOWS_KEY),
      cookies: [{ host: ".x.com", name: "auth_token", value: "token-win" }],
      localState: { os_crypt: { encrypted_key: wrapped.toString("base64") } },
    });
    const run = fakeRun({ "powershell.exe": { stdout: WINDOWS_KEY.toString("base64") } });
    const reader = profileSessionsReader(
      { platform: "win32", home: root, env: {} },
      platformKeySource("win32", run),
      () => NOW_MS,
    );
    const [session] = await reader.read("chrome/0/Default", ["x.com"]);
    expect(session?.cookies[0]?.value).toBe("token-win");
    expect(run.calls[0]?.input).toBe(Buffer.from("opaque-blob").toString("base64"));
  });

  it("lists Google Chrome only, not other Chromium browsers", async () => {
    await writeProfile({
      userDataDir: join(root, ".config", "chromium"),
      dbVersion: 24,
      keys: linuxV10,
      cookies: [{ host: ".x.com", name: "auth_token", value: "token-chromium" }],
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    expect(await reader.profiles()).toEqual([]);
  });

  it("imports every cookie of a chosen site, however many there are", async () => {
    const cookies = Array.from({ length: 200 }, (_, index) => ({
      host: ".x.com",
      name: `cookie_${index}`,
      value: `value-${index}`,
    }));
    await writeProfile({
      userDataDir: join(root, ".config", "google-chrome"),
      dbVersion: 24,
      keys: linuxV10,
      cookies,
    });
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    const [session] = await reader.read("chrome/0/Default", ["x.com"]);
    expect(session?.cookies.map((cookie) => cookie.value)).toEqual(
      cookies.map((cookie) => cookie.value),
    );
  });

  it("refuses a profile id it did not list", async () => {
    const reader = profileSessionsReader(
      linuxHost(),
      platformKeySource("linux", fakeRun({})),
      () => NOW_MS,
    );
    await expect(reader.read("../../etc/Default", ["x.com"])).rejects.toMatchObject({
      code: "profile_not_found",
    });
  });
});

describe("cookieBelongsToSite", () => {
  it("matches the site and its subdomains, never a lookalike", () => {
    expect(cookieBelongsToSite(".x.com", "x.com")).toBe(true);
    expect(cookieBelongsToSite("api.x.com", "x.com")).toBe(true);
    expect(cookieBelongsToSite("X.COM", "x.com")).toBe(true);
    expect(cookieBelongsToSite(".evilx.com", "x.com")).toBe(false);
    expect(cookieBelongsToSite("x.com.evil.net", "x.com")).toBe(false);
  });

  it("rejects a session whose cookie belongs to another site", () => {
    const cookie = {
      name: "auth_token",
      value: "v",
      domain: "evilx.com",
      hostOnly: false,
      path: "/",
      secure: true,
      httpOnly: true,
    };
    expect(SiteSession.safeParse({ site: "x.com", cookies: [cookie] }).success).toBe(false);
    expect(
      SiteSession.safeParse({ site: "x.com", cookies: [{ ...cookie, domain: "x.com" }] }).success,
    ).toBe(true);
  });
});
