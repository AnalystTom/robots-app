import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { screenSlotPath } from "@robots/core/node/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostKeyring } from "./host-browser-cookies.js";
import { cookieKey } from "./host-browser-cookies.js";
import { createHostDesktop } from "./host-desktop.js";
import { freePort } from "./host-desktop.test-support.js";

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const FUTURE_CHROME_TIME =
  (BigInt(Date.parse("2030-01-01T00:00:00Z") / 1000) + BigInt(CHROME_EPOCH_OFFSET_SECONDS)) *
  1_000_000n;
const keyring: HostKeyring = { passwords: async () => [] };

let home: string;
let child: ReturnType<typeof spawn> | undefined;
let server: Server | undefined;
let slot: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "robots-import-race-"));
});

afterEach(async () => {
  child?.kill();
  child = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  await rm(slot, { force: true });
  await rm(home, { recursive: true, force: true });
});

async function chromeProfileWithSignIn() {
  const root = path.join(home, ".config", "google-chrome");
  await mkdir(path.join(root, "Default", "Network"), { recursive: true });
  await writeFile(
    path.join(root, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Person" } } } }),
  );
  const db = new DatabaseSync(path.join(root, "Default", "Network", "Cookies"));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run("24");
  db.exec(
    "CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, is_persistent INTEGER, samesite INTEGER, priority INTEGER, source_scheme INTEGER)",
  );
  const plain = Buffer.concat([
    createHash("sha256").update(".x.com").digest(),
    Buffer.from("token"),
  ]);
  const cipher = createCipheriv("aes-128-cbc", cookieKey("peanuts"), Buffer.alloc(16, " "));
  const encrypted = Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
  db.prepare(
    "INSERT INTO cookies VALUES ('.x.com', '', 'auth_token', '', ?, '/', ?, 1, 1, 1, 0, 1, 2)",
  ).run(encrypted, FUTURE_CHROME_TIME);
  db.close();
}

describe.skipIf(process.platform !== "linux")(
  "sign-in import reusing a screen's debugging port",
  () => {
    it("never sends sign-ins to a browser that runs another screen's profile", async () => {
      await chromeProfileWithSignIn();
      const screenId = `race-${randomBytes(4).toString("hex")}`;
      const port = await freePort();
      slot = screenSlotPath(screenId);
      await mkdir(path.dirname(slot), { recursive: true });
      await writeFile(slot, "0\nlease:1\nview\n");

      const script = path.join(home, "idle.js");
      await writeFile(script, "setInterval(() => {}, 1000);\n");
      child = spawn(
        process.execPath,
        [script, `--remote-debugging-port=${port}`, `--user-data-dir=${home}/other-profile`],
        { stdio: "ignore" },
      );

      let upgrades = 0;
      server = createServer((request, response) => {
        if (request.url !== "/json/version") return response.writeHead(404).end();
        response.end(
          JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }),
        );
      });
      server.on("upgrade", (_request, socket) => {
        upgrades += 1;
        socket.destroy();
      });
      await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", () => resolve()));

      const desktop = createHostDesktop(
        path.join(home, "computers"),
        { displayStart: port - 9221, port: 6180, toolsDir: home },
        keyring,
        home,
      );
      await expect(
        desktop.importSessions(screenId, "chrome:Default", ["x.com"], AbortSignal.timeout(10_000)),
      ).rejects.toThrow("not running for this screen");
      expect(upgrades).toBe(0);
    });
  },
);
