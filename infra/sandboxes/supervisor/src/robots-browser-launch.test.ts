import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../computer/robots-browser");

let root: string;
let bin: string;
let home: string;
let argsFile: string;

function stub(name: string, body: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function launch(keyringExitCode: number) {
  stub("robots-browser-keyring", `exit ${keyringExitCode}`);
  return spawnSync("/bin/sh", [script, "about:blank"], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      DISPLAY: ":77",
      LANGUAGE: "en_US",
      ROBOTS_BROWSER_PROFILE: join(home, "profile"),
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "robots-browser-launch-"));
  bin = join(root, "bin");
  home = join(root, "home");
  argsFile = join(root, "chromium-args");
  mkdirSync(bin);
  mkdirSync(home);
  stub("chromium", `printf '%s\\n' "$@" > '${argsFile}'`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("robots-browser launch", () => {
  it("opens the profile with the desktop keyring when the keyring is ready", () => {
    const result = launch(0);
    expect(result.status).toBe(0);
    expect(existsSync(argsFile)).toBe(true);
    const args = readFileSync(argsFile, "utf8").split("\n");
    expect(args).toContain("--password-store=gnome-libsecret");
    expect(args).not.toContain("--password-store=basic");
  });

  it("refuses to open the profile when the keyring is not ready, never with the public basic store", () => {
    const result = launch(1);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Browser could not start securely - try restarting the computer",
    );
    expect(existsSync(argsFile)).toBe(false);
  });
});
