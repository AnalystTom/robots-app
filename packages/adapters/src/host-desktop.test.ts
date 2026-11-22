import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AdapterContext, ComputerRef } from "@robots/adapter-kit";
import type { PrismaClient } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { HostAwareSandbox } from "./host-aware-sandbox.js";
import { HostComputerAccessDeniedError, hostComputerGate } from "./host-computer-access.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { createHostDesktop } from "./host-desktop.js";
import { freePort, stubDesktopTools } from "./host-desktop.test-support.js";

const run = promisify(execFile);
const users: Record<string, { email: string; emailVerified: boolean }> = {
  admin: { email: "owner@example.test", emailVerified: true },
  member: { email: "member@example.test", emailVerified: true },
};

function database() {
  return {
    deploymentSettings: {
      findUnique: async () => ({ computerHost: "this-mac", updatedAt: new Date(0) }),
    },
    computer: { findUnique: async () => ({ spaceId: "admin-space" }) },
    spaceMember: {
      findMany: async ({ where }: { where: { role: string } }) =>
        where.role === "owner" ? [{ userId: "admin" }] : [],
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => (users[id] ? [users[id]] : [])),
    },
  } as unknown as PrismaClient;
}

function asker(userId: string): AdapterContext {
  return {
    operationId: "host-screen",
    traceId: "host-screen",
    spaceId: "admin-space",
    userId,
    botId: "host-screen-bot",
    signal: AbortSignal.timeout(110_000),
  };
}

describe.skipIf(process.platform !== "linux")("host computer screen", () => {
  let root: string;
  let toolsDir: string;
  let server: Awaited<ReturnType<typeof startHostComputerServer>>;
  let routed: HostAwareSandbox;
  let computer: ComputerRef;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "robots-host-screen-"));
    toolsDir = path.join(root, "tools");
    await stubDesktopTools(toolsDir);
    const token = randomBytes(32).toString("hex");
    server = await startHostComputerServer({
      root: path.join(root, "computers"),
      token,
      port: 0,
      hostname: "127.0.0.1",
      desktop: createHostDesktop(path.join(root, "computers"), {
        displayStart: 3000 + Math.floor(Math.random() * 20_000),
        port: await freePort(),
        toolsDir,
      }),
    });
    server.setEnabled(true);
    routed = new HostAwareSandbox(
      new FakeSandboxProvider(),
      new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token),
      hostComputerGate(database(), { adminEmails: ["owner@example.test"], singleAccount: false }),
    );
    computer = await routed.provision({ botId: "admin-home", homePath: "" }, asker("admin"));
  }, 60_000);

  afterAll(async () => {
    await routed?.releaseScreen(computer, asker("admin"));
    await server?.close();
    await run("pkill", ["-f", toolsDir]).catch((error: { code?: number }) => {
      if (error.code !== 1) throw error;
    });
    await rm(root, { recursive: true, force: true });
  }, 120_000);

  it("is provisioned on this computer for an admin's Space", () => {
    expect(computer.kind).toBe("desktop");
  });

  it("gives an admin a screen on this computer and lets them take control", async () => {
    const view = await routed.connectScreen(computer, { view: "stream" }, asker("admin"));
    expect(view.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/embed\.html\?/);
    expect(new URL(view.url!).searchParams.get("path")).toMatch(/^websockify\?token=[\w-]+$/);

    await routed.setScreenControl(computer, true, asker("admin"), "control-lease");
    const control = await routed.connectScreen(
      computer,
      { view: "stream", interactive: true, controlToken: "control-lease" },
      asker("admin"),
    );
    expect(new URL(control.url!).searchParams.get("path")).toBe("websockify?token=control-lease");
    await routed.setScreenControl(computer, false, asker("admin"), "control-lease");
  }, 110_000);

  it("refuses the screen, control and sign-in import to anyone else", async () => {
    await expect(
      routed.connectScreen(computer, { view: "stream" }, asker("member")),
    ).rejects.toBeInstanceOf(HostComputerAccessDeniedError);
    await expect(
      routed.setScreenControl(computer, true, asker("member"), "other-lease"),
    ).rejects.toBeInstanceOf(HostComputerAccessDeniedError);
    await expect(routed.hostBrowserProfiles(computer, asker("member"))).rejects.toBeInstanceOf(
      HostComputerAccessDeniedError,
    );
    await expect(
      routed.importHostBrowserSessions(
        computer,
        { profile: "chrome:Default", sites: ["x.com"] },
        asker("member"),
      ),
    ).rejects.toBeInstanceOf(HostComputerAccessDeniedError);
  });
});
