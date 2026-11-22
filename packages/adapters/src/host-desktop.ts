import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { HostBrowserImportResult } from "@robots/adapter-kit";
import { pollUntil } from "@robots/core";
import type { DesktopEnvironment } from "@robots/core/node/desktop-runtime";
import { browserProfilePathForScreen, screenSlotPath } from "@robots/core/node/desktop-runtime";
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
    const port = await debugPort(screenId);
    const found = await readHostBrowserCookies(home, profile, sites, keyring);
    const cookies = found.flatMap((site) => site.cookies);
    if (cookies.length > 0) {
      await setBrowserCookies(port, cookies, signal);
      const expected = cookies.map(importedCookieIdentity);
      const userDataDir = browserProfilePathForScreen(screenId, environment(home));
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
    }
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

async function setBrowserCookies(port: number, cookies: HostBrowserCookie[], signal: AbortSignal) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal });
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
      signal.addEventListener("abort", fail, { once: true });
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
