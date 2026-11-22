import { createCipheriv, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostKeyring } from "./host-browser-cookies.js";
import {
  cookieBelongsToSite,
  cookieKey,
  listHostBrowserProfiles,
  normalizeSite,
  readHostBrowserCookies,
  siteNames,
} from "./host-browser-cookies.js";
import { createHostDesktop } from "./host-desktop.js";

const KEYRING_PASSWORD = "fake-keyring-password";
const NOW = Date.parse("2026-11-22T00:00:00Z");
const FUTURE_CHROME_TIME =
  (BigInt(Date.parse("2027-11-15T00:00:00Z") / 1000) + 11_644_473_600n) * 1_000_000n;
const PAST_CHROME_TIME =
  (BigInt(Date.parse("2025-01-01T00:00:00Z") / 1000) + 11_644_473_600n) * 1_000_000n;

interface FakeCookie {
  host: string;
  name: string;
  value: string;
  prefix?: string;
  password?: string;
  hostHash?: string;
  expires?: bigint;
  partitioned?: boolean;
}

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "robots-host-cookies-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function encrypt(cookie: FakeCookie, dbVersion: number) {
  const prefix = cookie.prefix ?? "v11";
  const password = cookie.password ?? (prefix === "v10" ? "peanuts" : KEYRING_PASSWORD);
  const plain = Buffer.concat([
    dbVersion >= 24
      ? createHash("sha256")
          .update(cookie.hostHash ?? cookie.host)
          .digest()
      : Buffer.alloc(0),
    Buffer.from(cookie.value),
  ]);
  const cipher = createCipheriv("aes-128-cbc", cookieKey(password), Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from(prefix), cipher.update(plain), cipher.final()]);
}

async function profile(
  cookies: FakeCookie[],
  options: { browser?: string; dir?: string; name?: string; dbVersion?: number } = {},
) {
  const browserDir = path.join(home, options.browser ?? ".config/google-chrome");
  const dir = options.dir ?? "Default";
  const dbVersion = options.dbVersion ?? 24;
  await mkdir(path.join(browserDir, dir, "Network"), { recursive: true });
  await writeFile(
    path.join(browserDir, "Local State"),
    JSON.stringify({ profile: { info_cache: { [dir]: { name: options.name ?? "Person" } } } }),
  );
  const db = new DatabaseSync(path.join(browserDir, dir, "Network", "Cookies"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(String(dbVersion));
  db.exec(
    "CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, is_persistent INTEGER, samesite INTEGER, priority INTEGER, source_scheme INTEGER)",
  );
  const insert = db.prepare(
    "INSERT INTO cookies VALUES (?, ?, ?, '', ?, '/', ?, 1, 1, 1, 0, 1, 2)",
  );
  for (const cookie of cookies) {
    insert.run(
      cookie.host,
      cookie.partitioned ? "https://other.test" : "",
      cookie.name,
      encrypt(cookie, dbVersion),
      cookie.expires ?? FUTURE_CHROME_TIME,
    );
  }
  db.close();
}

function keyring(passwords: string[] = ["wrong-password", KEYRING_PASSWORD]): HostKeyring & {
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    passwords: async (application) => {
      asked.push(application);
      return passwords;
    },
  };
}

describe("host browser cookies", () => {
  it("matches a site and its subdomains only", () => {
    expect(cookieBelongsToSite(".x.com", "x.com")).toBe(true);
    expect(cookieBelongsToSite("api.x.com", "x.com")).toBe(true);
    expect(cookieBelongsToSite(".evilx.com", "x.com")).toBe(false);
    expect(cookieBelongsToSite("x.com.evil.test", "x.com")).toBe(false);
    expect(normalizeSite(" .X.com ")).toBe("x.com");
    expect(() => normalizeSite("localhost")).toThrow("not a site name");
    expect(() => normalizeSite("x.com/path")).toThrow("not a site name");
  });

  it("collapses subdomains into the sites a person picks from", () => {
    expect(
      siteNames([".x.com", "api.x.com", "x.com", ".google.com", "accounts.google.com"]),
    ).toEqual(["google.com", "x.com"]);
  });

  it("lists profiles with their sites and never their values", async () => {
    await profile([{ host: ".x.com", name: "auth_token", value: "secret-value" }], {
      name: "Owner",
    });
    await profile(
      [{ host: ".github.com", name: "session", value: "other-secret", prefix: "v10" }],
      {
        browser: ".config/chromium",
        name: "Work",
      },
    );
    const listed = await listHostBrowserProfiles(home);
    expect(listed).toEqual([
      { id: "chrome:Default", name: "Owner (Chrome)", sites: ["x.com"] },
      { id: "chromium:Default", name: "Work (Chromium)", sites: ["github.com"] },
    ]);
    expect(JSON.stringify(listed)).not.toContain("secret");
  });

  it("decrypts keyring and public-key cookies with the host hash prefix", async () => {
    await profile([
      { host: ".x.com", name: "auth_token", value: "token-a" },
      { host: "x.com", name: "ct0", value: "token-b", prefix: "v10" },
      { host: ".evilx.com", name: "auth_token", value: "not-ours" },
    ]);
    const ring = keyring();
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], ring, NOW);
    expect(ring.asked).toEqual(["chrome"]);
    expect(x?.site).toBe("x.com");
    expect(x?.cookies).toEqual([
      expect.objectContaining({ name: "auth_token", value: "token-a", domain: ".x.com" }),
      expect.objectContaining({ name: "ct0", value: "token-b", url: "https://x.com/" }),
    ]);
    expect(x?.cookies[0]).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "None",
      priority: "Medium",
      sourceScheme: "Secure",
      expires: Date.parse("2027-11-15T00:00:00Z") / 1000,
    });
  });

  it("refuses databases from before the host hash prefix instead of trusting unauthenticated values", async () => {
    await profile([{ host: ".x.com", name: "auth_token", value: "old-token" }], { dbVersion: 23 });
    await expect(
      readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring(), NOW),
    ).rejects.toThrow("too old to import from");
  });

  it("reports a site whose sign-ins have all expired as having no cookies", async () => {
    await profile([
      { host: ".x.com", name: "auth_token", value: "old", expires: PAST_CHROME_TIME },
    ]);
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring(), NOW);
    expect(x).toEqual({ site: "x.com", cookies: [] });
  });

  it("refuses an import when no chosen site has a current sign-in, naming them", async () => {
    await profile([
      { host: ".x.com", name: "auth_token", value: "old", expires: PAST_CHROME_TIME },
    ]);
    const desktop = createHostDesktop(
      home,
      { displayStart: 100, port: 6180, toolsDir: home },
      keyring(),
      home,
    );
    await expect(
      desktop.importSessions("screen", "chrome:Default", ["x.com"], AbortSignal.timeout(5_000)),
    ).rejects.toThrow("No current sign-in for x.com in that profile");
  });

  it("marks a site unreadable when a value's host hash does not match its host", async () => {
    await profile([{ host: ".x.com", name: "auth_token", value: "moved", hostHash: ".evil.test" }]);
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring(), NOW);
    expect(x).toEqual({
      site: "x.com",
      cookies: [],
      unreadable: expect.stringContaining("could not be decrypted"),
    });
  });

  it("marks a site unreadable for an encryption scheme it does not know instead of guessing", async () => {
    await profile([{ host: ".x.com", name: "auth_token", value: "token", prefix: "v12" }]);
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring(), NOW);
    expect(x?.cookies).toEqual([]);
    expect(x?.unreadable).toContain("cannot read");
  });

  it("asks for the keyring to be unlocked when it gives no key", async () => {
    await profile([{ host: ".x.com", name: "auth_token", value: "token" }]);
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring([]), NOW);
    expect(x?.cookies).toEqual([]);
    expect(x?.unreadable).toContain("Unlock this computer's keyring");
  });

  it("keeps the other sites readable when one site cannot be decrypted", async () => {
    await profile([
      { host: ".x.com", name: "auth_token", value: "token-x", prefix: "v10" },
      { host: ".y.test", name: "sid", value: "moved", prefix: "v10", hostHash: ".evil.test" },
    ]);
    const [x, y] = await readHostBrowserCookies(
      home,
      "chrome:Default",
      ["x.com", "y.test"],
      keyring(),
      NOW,
    );
    expect(x?.cookies.map((cookie) => cookie.value)).toEqual(["token-x"]);
    expect(y).toEqual({
      site: "y.test",
      cookies: [],
      unreadable: expect.stringContaining("could not be decrypted"),
    });
  });

  it("leaves the keyring alone when only public-key cookies are chosen", async () => {
    await profile([
      { host: ".x.com", name: "auth_token", value: "token", prefix: "v10" },
      { host: ".other.test", name: "sid", value: "keyring-only" },
    ]);
    const ring = keyring();
    await readHostBrowserCookies(home, "chrome:Default", ["x.com"], ring, NOW);
    expect(ring.asked).toEqual([]);
  });

  it("skips expired and partitioned cookies", async () => {
    await profile([
      { host: ".x.com", name: "live", value: "a" },
      { host: ".x.com", name: "expired", value: "b", expires: PAST_CHROME_TIME },
      { host: ".x.com", name: "partitioned", value: "c", partitioned: true },
    ]);
    const [x] = await readHostBrowserCookies(home, "chrome:Default", ["x.com"], keyring(), NOW);
    expect(x?.cookies.map((cookie) => cookie.name)).toEqual(["live"]);
  });

  it("refuses a profile that is not on this computer", async () => {
    await expect(
      readHostBrowserCookies(home, "chrome:Elsewhere", ["x.com"], keyring(), NOW),
    ).rejects.toThrow("not on this computer");
  });
});
