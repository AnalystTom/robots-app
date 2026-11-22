import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encryptCookieForTest, linuxCookieKeys } from "@robots/adapters/browser-cookie-crypto";
import {
  platformKeySource,
  profileSessionsReader,
} from "@robots/adapters/browser-profile-sessions";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserSessionsHandlers } from "./browser-sessions.js";

const frame = { url: "https://app.example.com/app/settings" };
const contents = Object.assign(new EventEmitter(), {
  mainFrame: frame,
  isDestroyed: () => false,
}) as unknown as WebContents;
const appEvent = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
const subframeEvent = {
  sender: contents,
  senderFrame: { url: "https://app.example.com/embed" },
} as unknown as IpcMainInvokeEvent;
const target = { webContents: contents, url: "https://app.example.com" };

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "robots-desktop-sessions-"));
  const userDataDir = join(home, ".config", "chromium");
  await mkdir(join(userDataDir, "Default", "Network"), { recursive: true });
  await writeFile(
    join(userDataDir, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } }),
  );
  const db = new DatabaseSync(join(userDataDir, "Default", "Network", "Cookies"));
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT,
      encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
      is_persistent INTEGER, samesite INTEGER)`);
  db.exec("INSERT INTO meta VALUES ('version', '24')");
  const encrypted = encryptCookieForTest(
    "fixture-token",
    { hostKey: ".x.com", dbVersion: 24, version: "v10" },
    linuxCookieKeys([]),
  );
  db.prepare(
    "INSERT INTO cookies VALUES ('.x.com', '', 'auth_token', '', ?, '/', 0, 1, 1, 0, 0)",
  ).run(encrypted);
  db.close();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function handlers() {
  return createBrowserSessionsHandlers(
    () => target,
    profileSessionsReader(
      { platform: "linux", home, env: {} },
      platformKeySource("linux", async () => {
        throw new Error("a v10 profile never asks the keyring");
      }),
    ),
  );
}

describe("desktop browser sessions bridge", () => {
  it("lists the local profile and reads only the chosen site for the app page", async () => {
    const bridge = handlers();
    expect(await bridge.profiles(appEvent)).toEqual([
      {
        id: "chromium/0/Default",
        name: "Work",
        browser: "Chromium",
        sites: [{ site: "x.com", cookies: 1 }],
      },
    ]);
    const read = await bridge.read(appEvent, "chromium/0/Default", ["x.com"]);
    expect(read).toMatchObject({
      ok: true,
      sessions: [{ site: "x.com", cookies: [{ name: "auth_token", value: "fixture-token" }] }],
    });
  });

  it("answers nothing to a subframe or a malformed request", async () => {
    const bridge = handlers();
    expect(await bridge.profiles(subframeEvent)).toBeNull();
    expect(await bridge.read(subframeEvent, "chromium/0/Default", ["x.com"])).toBeNull();
    expect(await bridge.read(appEvent, "chromium/0/Default", ["not a site"])).toBeNull();
    expect(await bridge.read(appEvent, "chromium/0/Default", [])).toBeNull();
    expect(await bridge.read(appEvent, 7, ["x.com"])).toBeNull();
  });

  it("turns a refusal into a code the page can explain", async () => {
    expect(await handlers().read(appEvent, "chrome/0/Default", ["x.com"])).toEqual({
      ok: false,
      code: "profile_not_found",
      error: "That browser profile is gone.",
    });
  });
});
