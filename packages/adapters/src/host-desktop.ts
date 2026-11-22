import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { HostBrowserImportResult } from "@robots/adapter-kit";
import { pollUntil } from "@robots/core";
import type { DesktopEnvironment } from "@robots/core/node/desktop-runtime";
import {
  browserProfilePathForScreen,
  desktopRegistryLockPath,
  screenSlotPath,
} from "@robots/core/node/desktop-runtime";
import type { HostBrowserCookie, HostKeyring } from "./host-browser-cookies.js";
import {
  HostBrowserCookieError,
  importedCookieIdentity,
  listHostBrowserProfiles,
  readHostBrowserCookies,
  savedCookieNames,
  secretToolKeyring,
} from "./host-browser-cookies.js";
import type { HostDesktopRun } from "./host-computer-protocol.js";

export interface HostDesktopOptions {
  displayStart: number;
  port: number;
  toolsDir: string;
}

const CDP_EXCHANGE_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TIMED_OUT = 124;
const SAVE_TIMEOUT_MS = 90_000;
const DESKTOP_ENV = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
];

export function createHostDesktop(
  root: string,
  options: HostDesktopOptions,
  keyring: HostKeyring = secretToolKeyring(),
  home = homedir(),
) {
  const browserProfilesDir = path.join(root, "browser-profiles");

  function environment(workspace: string): DesktopEnvironment {
    return {
      homeDir: workspace,
      workspaceDir: workspace,
      browserProfilesDir,
      displayStart: options.displayStart,
      portStart: options.port,
      bindHost: "127.0.0.1",
      preservePrimaryDisplay: false,
      toolsDir: options.toolsDir,
      hostBrowser: true,
    };
  }

  function scriptEnvironment() {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined && (DESKTOP_ENV.includes(name) || name.startsWith("LC_")))
        env[name] = value;
    }
    env.PATH = `${path.join(options.toolsDir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`;
    return env;
  }

  function run(
    script: string,
    input: string | undefined,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<HostDesktopRun> {
    return new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const child = spawn("bash", ["-c", script], {
        env: scriptEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        signal: AbortSignal.any([signal, timeout]),
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      const collect = (into: Buffer[]) => (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_OUTPUT_BYTES) into.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.stdin.end(input ?? "");
      child.once("error", (error) => {
        if (timeout.aborted && !signal.aborted)
          resolve({ code: TIMED_OUT, stdout: "", stderr: "timed out" });
        else reject(error);
      });
      child.once("close", (code) => {
        if (timeout.aborted && !signal.aborted) return;
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  }

  async function debugPort(screenId: string) {
    const slot = await readFile(screenSlotPath(screenId), "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const index = Number(slot.split("\n")[0]);
    if (!slot || !Number.isSafeInteger(index) || index < 0)
      throw new HostBrowserCookieError("Open the bot's screen first");
    return 9221 + options.displayStart + index;
  }

  async function importSessions(
    screenId: string,
    profile: string,
    sites: string[],
    signal: AbortSignal,
  ): Promise<HostBrowserImportResult> {
    const found = await readHostBrowserCookies(home, profile, sites, keyring);
    const usable = found.filter(({ cookies }) => cookies.length > 0);
    if (usable.length === 0)
      throw new HostBrowserCookieError(
        `No current sign-in for ${found.map(({ site }) => site).join(", ")} in that profile`,
      );
    const cookies = usable.flatMap((site) => site.cookies);
    const userDataDir = browserProfilePathForScreen(screenId, environment(home));
    await withRegistryLock(async () => {
      const port = await debugPort(screenId);
      await setBrowserCookies(port, cookies, userDataDir, signal);
    });
    const expected = cookies.map(importedCookieIdentity);
    await pollUntil(
      async () => {
        const saved = await savedCookieNames(userDataDir);
        return expected.every((cookie) => saved.has(cookie));
      },
      {
        intervalMs: 2_000,
        timeoutMs: SAVE_TIMEOUT_MS,
        signal,
        waitingFor: "the bot's browser to save the sign-ins",
      },
    );
    return { sites: found.map(({ site, cookies }) => ({ site, cookies: cookies.length })) };
  }

  return {
    environment,
    run,
    importSessions,
    profiles: () => listHostBrowserProfiles(home),
  };
}

export type HostDesktop = ReturnType<typeof createHostDesktop>;

async function withRegistryLock<T>(work: () => Promise<T>): Promise<T> {
  const lock = desktopRegistryLockPath();
  await mkdir(path.dirname(lock), { recursive: true });
  const holder = spawn("flock", ["-w", "120", lock, "sh", "-c", "echo locked; read _"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const closed = once(holder, "close");
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once("data", () => resolve());
      holder.once("error", reject);
      holder.once("close", () =>
        reject(new HostBrowserCookieError("The bot's screen is busy. Try again.")),
      );
    });
    return await work();
  } finally {
    holder.stdin.end();
    await closed;
  }
}

async function runsProfileOnPort(port: number, userDataDir: string) {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const argv = await readFile(`/proc/${entry}/cmdline`, "utf8").then(
      (text): string[] => text.split("\0"),
      (error: NodeJS.ErrnoException): string[] => {
        if (error.code === "ENOENT" || error.code === "EACCES") return [];
        throw error;
      },
    );
    if (
      argv.includes(`--remote-debugging-port=${port}`) &&
      argv.includes(`--user-data-dir=${userDataDir}`)
    )
      return true;
  }
  return false;
}

async function setBrowserCookies(
  port: number,
  cookies: HostBrowserCookie[],
  userDataDir: string,
  signal: AbortSignal,
) {
  if (!(await runsProfileOnPort(port, userDataDir)))
    throw new HostBrowserCookieError("The bot's browser is not running for this screen");
  const exchange = AbortSignal.any([signal, AbortSignal.timeout(CDP_EXCHANGE_TIMEOUT_MS)]);
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: exchange });
  const { webSocketDebuggerUrl } = (await version.json()) as { webSocketDebuggerUrl?: unknown };
  if (
    typeof webSocketDebuggerUrl !== "string" ||
    !webSocketDebuggerUrl.startsWith("ws://127.0.0.1:")
  )
    throw new HostBrowserCookieError("The bot's browser is not answering");
  const socket = new WebSocket(webSocketDebuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new HostBrowserCookieError("The bot's browser is not answering"));
      exchange.addEventListener("abort", fail, { once: true });
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method: "Storage.setCookies", params: { cookies } })),
      );
      socket.addEventListener("message", (event) => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: unknown };
        if (reply.id !== 1) return;
        if (reply.error)
          reject(new HostBrowserCookieError("The bot's browser refused the sign-ins"));
        else resolve();
      });
    });
  } finally {
    socket.close();
  }
}
