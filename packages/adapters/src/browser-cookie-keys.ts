import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CookieKeys } from "./browser-cookie-crypto.js";
import {
  BrowserSessionsError,
  linuxCookieKeys,
  macCookieKeys,
  windowsCookieKeys,
} from "./browser-cookie-crypto.js";

export interface KeyedBrowser {
  label: string;
  keyName: Partial<Record<NodeJS.Platform, string>>;
  keyringApplications: readonly string[];
}

export interface BrowserKeySource {
  cookieKeys(
    browser: KeyedBrowser,
    userDataDir: string,
    versions: ReadonlySet<string>,
  ): Promise<CookieKeys>;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  missing: boolean;
  timedOut: boolean;
}

export type RunCommand = (
  file: string,
  args: readonly string[],
  options: { timeoutMs: number; input?: string },
) => Promise<CommandResult>;

export const runCommand: RunCommand = (file, args, { timeoutMs, input }) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      { timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: failure ? (typeof failure.code === "number" ? failure.code : null) : 0,
          stdout: failure ? "" : stdout,
          missing: failure?.code === "ENOENT",
          timedOut: Boolean(failure?.killed),
        });
      },
    );
    child.stdin?.end(input ?? "");
  });

export const KEYRING_TIMEOUT_MS = 15_000;
export const KEYCHAIN_TIMEOUT_MS = 120_000;

const KEY_LOCKED = new BrowserSessionsError(
  "key_locked",
  "The system keyring did not answer. Unlock it and try again.",
);

function keyUnavailable(label: string) {
  return new BrowserSessionsError(
    "key_unavailable",
    `RoBots could not find ${label}'s saved key in the system keyring.`,
  );
}

async function linuxKeyringPasswords(browser: KeyedBrowser, run: RunCommand): Promise<string[]> {
  const passwords: string[] = [];
  let reachedKeyring = false;
  for (const application of browser.keyringApplications) {
    const result = await run("secret-tool", ["lookup", "application", application], {
      timeoutMs: KEYRING_TIMEOUT_MS,
    });
    if (result.timedOut) throw KEY_LOCKED;
    if (result.missing) break;
    reachedKeyring = true;
    const password = result.stdout.replace(/\r?\n$/, "");
    if (result.code === 0 && password) passwords.push(password);
  }
  if (!passwords.length && !reachedKeyring) {
    throw new BrowserSessionsError(
      "key_unavailable",
      "RoBots could not reach the system keyring. Install secret-tool and try again.",
    );
  }
  return passwords;
}

async function macKeychainPassword(browser: KeyedBrowser, run: RunCommand): Promise<string> {
  const keyName = browser.keyName.darwin;
  if (!keyName) throw keyUnavailable(browser.label);
  const result = await run(
    "/usr/bin/security",
    ["find-generic-password", "-w", "-s", `${keyName} Safe Storage`, "-a", keyName],
    { timeoutMs: KEYCHAIN_TIMEOUT_MS },
  );
  if (result.timedOut) {
    throw new BrowserSessionsError("key_denied", "The Keychain prompt was not answered.");
  }
  const password = result.stdout.replace(/\r?\n$/, "");
  if (result.code === 0 && password) return password;
  if (result.code === 44) throw keyUnavailable(browser.label);
  throw new BrowserSessionsError(
    "key_denied",
    `Allow RoBots to use ${browser.label}'s key in the Keychain prompt to import its sign-ins.`,
  );
}

const DPAPI_SCRIPT =
  "Add-Type -AssemblyName System.Security;" +
  "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
  "$o=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
  "[Console]::Out.Write([Convert]::ToBase64String($o))";

async function windowsMasterKey(
  browser: KeyedBrowser,
  userDataDir: string,
  run: RunCommand,
): Promise<Buffer> {
  let encoded: unknown;
  try {
    encoded = (
      JSON.parse(await readFile(join(userDataDir, "Local State"), "utf8")) as {
        os_crypt?: { encrypted_key?: unknown };
      }
    ).os_crypt?.encrypted_key;
  } catch {
    encoded = undefined;
  }
  if (typeof encoded !== "string") throw keyUnavailable(browser.label);
  const wrapped = Buffer.from(encoded, "base64");
  if (wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") throw keyUnavailable(browser.label);
  const result = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT],
    { timeoutMs: KEYRING_TIMEOUT_MS, input: wrapped.subarray(5).toString("base64") },
  );
  const key = result.code === 0 ? Buffer.from(result.stdout.trim(), "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw keyUnavailable(browser.label);
  return key;
}

export function platformKeySource(
  platform: NodeJS.Platform,
  run: RunCommand = runCommand,
): BrowserKeySource {
  return {
    async cookieKeys(browser, userDataDir, versions) {
      if (platform === "darwin") return macCookieKeys(await macKeychainPassword(browser, run));
      if (platform === "win32") {
        return windowsCookieKeys(await windowsMasterKey(browser, userDataDir, run));
      }
      if (!versions.has("v11")) return linuxCookieKeys([]);
      const passwords = await linuxKeyringPasswords(browser, run);
      if (!passwords.length) throw keyUnavailable(browser.label);
      return linuxCookieKeys(passwords);
    },
  };
}
