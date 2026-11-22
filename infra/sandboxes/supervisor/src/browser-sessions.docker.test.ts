import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";
import { expect, it } from "vitest";
import { deliverBrowserStoreKey } from "./browser-store-key.js";

it.skipIf(process.env.VERIFY_DOCKER_BROWSER_SESSIONS !== "1")(
  "keeps imported sessions across a browser kill and never under the public key",
  async () => {
    const name = `robots-browser-sessions-test-${randomUUID()}`;
    const dataDir = mkdtempSync(path.join(tmpdir(), "robots-browser-sessions-"));
    const docker = (...args: string[]) =>
      execFileSync("docker", args, { encoding: "utf8", timeout: 400_000 });
    try {
      docker(
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "none",
        "--shm-size=512m",
        process.env.ROBOTS_COMPUTER_IMAGE ?? "robots/computer:local",
      );
      docker(
        "exec",
        name,
        "sh",
        "-c",
        "for i in $(seq 1 60); do [ -s /tmp/robots/dbus-session ] && exit 0; sleep 0.5; done; exit 1",
      );
      await deliverBrowserStoreKey(new Docker().getContainer(name), dataDir, name);
      docker(
        "cp",
        fileURLToPath(new URL("../../computer/test_browser_sessions.py", import.meta.url)),
        `${name}:/tmp/test_browser_sessions.py`,
      );
      const output = docker("exec", name, "python3", "-I", "/tmp/test_browser_sessions.py");
      expect(output).toContain("before: the basic store keeps the sign-in under the public key");
      expect(output).toContain("migrated: existing sign-in kept and resealed");
      expect(output).toContain(
        "imported: committed, survives SIGKILL, unreadable with the public key",
      );
      expect(output).toContain("removed: the bot's browser is signed out of the site");
      expect(output).toContain(
        "purged: the unreadable row was dropped at the next closed start and the profile marked keyed",
      );
      expect(output).toContain("guarded: without its key the browser refuses to open the profile");
      expect(output).toContain("PASS: browser sessions");
    } finally {
      try {
        docker("rm", "-f", name);
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    }
  },
  420_000,
);
