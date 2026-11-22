import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, Server } from "node:http";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DesktopEnvironment } from "@robots/core/node/desktop-runtime";
import {
  browserProfilePathForScreen,
  MAX_DESKTOP_DISPLAY,
  screenSlotPath,
} from "@robots/core/node/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostKeyring } from "./host-browser-cookies.js";
import { cookieKey } from "./host-browser-cookies.js";
import { createHostDesktop } from "./host-desktop.js";
import { freePort } from "./host-desktop.test-support.js";

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const FUTURE_CHROME_TIME =
  (BigInt(Date.parse("2030-01-01T00:00:00Z") / 1000) + BigInt(CHROME_EPOCH_OFFSET_SECONDS)) *
  1_000_000n;
const PAST_CHROME_TIME =
  (BigInt(Date.parse("2025-01-01T00:00:00Z") / 1000) + BigInt(CHROME_EPOCH_OFFSET_SECONDS)) *
  1_000_000n;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const keyring: HostKeyring = { passwords: async () => [] };

let home: string;
let children: ChildProcess[] = [];
let servers: Server[] = [];
let connections = new Set<Socket>();
let slots: string[] = [];

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "robots-import-"));
});

afterEach(async () => {
  for (const child of children) child.kill();
  children = [];
  for (const socket of connections) socket.destroy();
  connections = new Set();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers = [];
  await Promise.all(slots.map((slot) => rm(slot, { force: true })));
  slots = [];
  await rm(home, { recursive: true, force: true });
});

interface SignInRow {
  host: string;
  name: string;
  value: string;
  expires?: bigint;
}

async function chromeProfile(rows: SignInRow[]) {
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
  for (const row of rows) {
    const plain = Buffer.concat([
      createHash("sha256").update(row.host).digest(),
      Buffer.from(row.value),
    ]);
    const cipher = createCipheriv("aes-128-cbc", cookieKey("peanuts"), Buffer.alloc(16, " "));
    const encrypted = Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
    db.prepare("INSERT INTO cookies VALUES (?, '', ?, '', ?, '/', ?, 1, 1, 1, 0, 1, 2)").run(
      row.host,
      row.name,
      encrypted,
      row.expires ?? FUTURE_CHROME_TIME,
    );
  }
  db.close();
}

function desktopFor(screenId: string) {
  const root = path.join(home, "computers");
  const env = { browserProfilesDir: path.join(root, "browser-profiles") } as DesktopEnvironment;
  const slot = screenSlotPath(screenId);
  slots.push(slot);
  return {
    root,
    userDataDir: browserProfilePathForScreen(screenId, env),
    slot,
    desktop: (port: number) =>
      createHostDesktop(
        root,
        { displayStart: port - 9221, port: 6180, toolsDir: home },
        keyring,
        home,
      ),
  };
}

function readFrame(buffer: Buffer) {
  if (buffer.length < 2) return undefined;
  const lengthByte = buffer[1] ?? 0;
  let length = lengthByte & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const mask = (lengthByte & 0x80) !== 0 ? buffer.subarray(offset, offset + 4) : undefined;
  if (mask) offset += 4;
  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask)
    for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  return { text: payload.toString("utf8"), rest: buffer.subarray(offset + length) };
}

function textFrame(text: string) {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.concat([Buffer.from([0x81, 126]), Buffer.alloc(2)]);
  if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

async function fakeBrowser(
  port: number,
  userDataDir: string,
  onCookies?: (cookies: Array<{ domain?: string; url?: string; name: string }>) => void,
  processTitle?: string,
) {
  const idle = path.join(home, "idle.js");
  await writeFile(idle, "setInterval(() => {}, 1000);\n");
  children.push(
    spawn(
      process.execPath,
      processTitle === undefined
        ? [idle, `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`]
        : ["-e", `process.title = ${JSON.stringify(processTitle)}; setInterval(() => {}, 1000);`],
      {
        stdio: "ignore",
      },
    ),
  );
  const server = createServer((request: IncomingMessage, response) => {
    if (request.url !== "/json/version") return response.writeHead(404).end();
    response.end(
      JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }),
    );
  });
  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}${WEBSOCKET_GUID}`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buffered: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]) as Buffer;
      for (let frame = readFrame(buffered); frame; frame = readFrame(buffered)) {
        buffered = frame.rest;
        if (!frame.text.startsWith("{")) continue;
        const message = JSON.parse(frame.text) as {
          id: number;
          method: string;
          params: { cookies: Array<{ domain?: string; url?: string; name: string }> };
        };
        if (message.method === "Storage.setCookies") onCookies?.(message.params.cookies);
        socket.write(textFrame(JSON.stringify({ id: message.id, result: {} })));
      }
    });
  });
  servers.push(server);
  server.on("connection", (socket) => connections.add(socket));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
}

async function saveCookiesInto(
  userDataDir: string,
  cookies: Array<{ domain?: string; url?: string; name: string }>,
) {
  const file = path.join(userDataDir, "Default", "Network", "Cookies");
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS cookies (host_key TEXT, name TEXT)");
  for (const cookie of cookies) {
    db.prepare("INSERT INTO cookies VALUES (?, ?)").run(
      cookie.domain ?? new URL(cookie.url ?? "http://invalid").hostname,
      cookie.name,
    );
  }
  db.close();
}

async function registerSlot(screenId: string, port: number) {
  const { slot } = desktopFor(screenId);
  await mkdir(path.dirname(slot), { recursive: true });
  await writeFile(slot, "0\nlease:1\nview\n");
  return port;
}

describe.skipIf(process.platform !== "linux")("sign-in import into a screen's browser", () => {
  it("imports the usable sites and names the skipped ones", async () => {
    await chromeProfile([
      { host: ".x.com", name: "auth_token", value: "token-x" },
      { host: ".y.test", name: "sid", value: "old", expires: PAST_CHROME_TIME },
    ]);
    const screenId = `mixed-${randomBytes(4).toString("hex")}`;
    const port = await registerSlot(screenId, await freePort());
    const { desktop, userDataDir } = desktopFor(screenId);
    const sent: Array<{ domain?: string; url?: string; name: string }> = [];
    await fakeBrowser(port, userDataDir, (cookies) => {
      sent.push(...cookies);
      saveCookiesInto(userDataDir, cookies);
    });

    const result = await desktop(port).importSessions(
      screenId,
      "chrome:Default",
      ["x.com", "y.test"],
      AbortSignal.timeout(20_000),
    );
    expect(result).toEqual({
      sites: [
        { site: "x.com", cookies: 1 },
        { site: "y.test", cookies: 0 },
      ],
    });
    expect(sent.map((cookie) => cookie.name)).toEqual(["auth_token"]);
  }, 30_000);

  it("imports into a browser whose process title is its space-joined command line", async () => {
    await chromeProfile([{ host: ".x.com", name: "auth_token", value: "token-x" }]);
    const screenId = `title-${randomBytes(4).toString("hex")}`;
    const port = await registerSlot(screenId, await freePort());
    const { desktop, userDataDir } = desktopFor(screenId);
    const sent: Array<{ domain?: string; url?: string; name: string }> = [];
    await fakeBrowser(
      port,
      userDataDir,
      (cookies) => {
        sent.push(...cookies);
        saveCookiesInto(userDataDir, cookies);
      },
      `chromium --remote-debugging-port=${port} --user-data-dir=${userDataDir}`,
    );

    await expect(
      desktop(port).importSessions(
        screenId,
        "chrome:Default",
        ["x.com"],
        AbortSignal.timeout(20_000),
      ),
    ).resolves.toEqual({ sites: [{ site: "x.com", cookies: 1 }] });
    expect(sent.map((cookie) => cookie.name)).toEqual(["auth_token"]);
  }, 30_000);

  it("fails naming every site when none of them has a usable sign-in", async () => {
    await chromeProfile([
      { host: ".x.com", name: "auth_token", value: "old", expires: PAST_CHROME_TIME },
      { host: ".y.test", name: "sid", value: "old", expires: PAST_CHROME_TIME },
    ]);
    const screenId = `none-${randomBytes(4).toString("hex")}`;
    const port = await registerSlot(screenId, await freePort());
    await expect(
      desktopFor(screenId)
        .desktop(port)
        .importSessions(
          screenId,
          "chrome:Default",
          ["x.com", "y.test"],
          AbortSignal.timeout(5_000),
        ),
    ).rejects.toThrow("No current sign-in for x.com, y.test in that profile");
  });

  it("never sends sign-ins to a browser that runs another screen's profile", async () => {
    await chromeProfile([{ host: ".x.com", name: "auth_token", value: "token-x" }]);
    const screenId = `race-${randomBytes(4).toString("hex")}`;
    const port = await registerSlot(screenId, await freePort());
    const { desktop } = desktopFor(screenId);
    const idle = path.join(home, "other.js");
    await writeFile(idle, "setInterval(() => {}, 1000);\n");
    children.push(
      spawn(
        process.execPath,
        [idle, `--remote-debugging-port=${port}`, `--user-data-dir=${home}/other-profile`],
        {
          stdio: "ignore",
        },
      ),
    );
    let upgrades = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/json/version") return response.writeHead(404).end();
      response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/x` }));
    });
    server.on("upgrade", (_request, socket) => {
      upgrades += 1;
      socket.destroy();
    });
    servers.push(server);
    server.on("connection", (socket) => connections.add(socket));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));

    await expect(
      desktop(port).importSessions(
        screenId,
        "chrome:Default",
        ["x.com"],
        AbortSignal.timeout(10_000),
      ),
    ).rejects.toThrow("not running for this screen");
    expect(upgrades).toBe(0);
  });

  it("never sends sign-ins to a titled browser that runs another screen's profile", async () => {
    await chromeProfile([{ host: ".x.com", name: "auth_token", value: "token-x" }]);
    const screenId = `titled-race-${randomBytes(4).toString("hex")}`;
    const port = await registerSlot(screenId, await freePort());
    const { desktop } = desktopFor(screenId);
    let upgrades = 0;
    const server = createServer((request, response) => {
      if (request.url !== "/json/version") return response.writeHead(404).end();
      response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/x` }));
    });
    server.on("upgrade", (_request, socket) => {
      upgrades += 1;
      socket.destroy();
    });
    servers.push(server);
    server.on("connection", (socket) => connections.add(socket));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    children.push(
      spawn(
        process.execPath,
        [
          "-e",
          `process.title = ${JSON.stringify(`chromium --remote-debugging-port=${port} --user-data-dir=${home}/other-profile-extra`)}; setInterval(() => {}, 1000);`,
        ],
        { stdio: "ignore" },
      ),
    );

    await expect(
      desktop(port).importSessions(
        screenId,
        "chrome:Default",
        ["x.com"],
        AbortSignal.timeout(10_000),
      ),
    ).rejects.toThrow("not running for this screen");
    expect(upgrades).toBe(0);
  });

  async function importAtScreenIndex(index: number) {
    await chromeProfile([{ host: ".x.com", name: "auth_token", value: "token-x" }]);
    const screenId = `range-${randomBytes(4).toString("hex")}`;
    const slot = screenSlotPath(screenId);
    slots.push(slot);
    await mkdir(path.dirname(slot), { recursive: true });
    await writeFile(slot, `${index}\nlease:1\nview\n`);
    const desktop = createHostDesktop(
      path.join(home, "computers"),
      { displayStart: 100, port: 6180, toolsDir: home },
      keyring,
      home,
    );
    return desktop.importSessions(
      screenId,
      "chrome:Default",
      ["x.com"],
      AbortSignal.timeout(5_000),
    );
  }

  it("refuses a screen whose browser port would be past the TCP range", async () => {
    await expect(importAtScreenIndex(MAX_DESKTOP_DISPLAY - 100 + 1)).rejects.toThrow(
      "no free browser port",
    );
  });

  it("keeps the last screen whose browser port is still in the TCP range", async () => {
    await expect(importAtScreenIndex(MAX_DESKTOP_DISPLAY - 100)).rejects.toThrow(
      "not running for this screen",
    );
  });
});
