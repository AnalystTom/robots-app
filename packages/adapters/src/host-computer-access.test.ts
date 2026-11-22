import type { ComputerRef } from "@robots/adapter-kit";
import type { PrismaClient } from "@robots/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { createRunSandbox, HostAwareSandbox } from "./host-aware-sandbox.js";
import type { HostComputerAccess } from "./host-computer-access.js";
import { hostComputerAccessFromEnv, hostComputerGate } from "./host-computer-access.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";

const ctx = {
  operationId: "1",
  traceId: "1",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const users: Record<string, { email: string; emailVerified: boolean }> = {
  admin: { email: "Owner@Example.test", emailVerified: true },
  coAdmin: { email: "second@example.test", emailVerified: true },
  member: { email: "member@example.test", emailVerified: true },
  unverified: { email: "owner@example.test", emailVerified: false },
};
const owners: Record<string, string[]> = {
  "admin-space": ["admin"],
  "two-admin-space": ["admin", "coAdmin"],
  "member-space": ["member"],
  "mixed-space": ["admin", "member"],
  "unverified-space": ["unverified"],
  "ownerless-space": [],
};
const computers: Record<string, string> = Object.fromEntries(
  Object.keys(owners).map((spaceId) => [`home-${spaceId}`, spaceId]),
);
const admins: HostComputerAccess = {
  adminEmails: ["owner@example.test", "second@example.test"],
  singleAccount: false,
};

function database(computerHost: string | null = "this-mac") {
  return {
    deploymentSettings: {
      findUnique: vi.fn(async () => ({ computerHost, updatedAt: new Date(0) })),
    },
    computer: {
      findUnique: vi.fn(async ({ where }: { where: { homeKey: string } }) =>
        computers[where.homeKey] ? { spaceId: computers[where.homeKey] } : null,
      ),
    },
    spaceMember: {
      findMany: vi.fn(async ({ where }: { where: { spaceId: string; role: string } }) =>
        where.role === "owner" ? (owners[where.spaceId] ?? []).map((userId) => ({ userId })) : [],
      ),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => (users[id] ? [users[id]] : [])),
      ),
    },
  };
}

function desktopComputer(spaceId: string): ComputerRef {
  return { id: `computer-${spaceId}`, botId: `home-${spaceId}`, kind: "desktop", providerRef: "x" };
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const _event of events) {
  }
}

afterEach(() => vi.restoreAllMocks());

describe("host computer access", () => {
  it("reads admins and the desktop app's single account from the environment", () => {
    expect(
      hostComputerAccessFromEnv({ ROBOTS_ADMIN_EMAILS: " A@Example.test, b@example.test " }),
    ).toEqual({ adminEmails: ["a@example.test", "b@example.test"], singleAccount: false });
    expect(hostComputerAccessFromEnv({ ROBOTS_DESKTOP_STACK_TOKEN: "ab".repeat(32) })).toEqual({
      adminEmails: [],
      singleAccount: true,
    });
  });

  it.each([
    ["admin-space", true],
    ["two-admin-space", true],
    ["member-space", false],
    ["mixed-space", false],
    ["unverified-space", false],
    ["ownerless-space", false],
    ["unknown-space", false],
  ])(
    "lets only spaces every owner of which is a verified admin use it (%s)",
    async (space, allowed) => {
      expect(await hostComputerGate(database() as never, admins).forHome(`home-${space}`)).toBe(
        allowed,
      );
    },
  );

  it("is closed while the deployment does not choose this computer, and without admins", async () => {
    expect(
      await hostComputerGate(database("docker") as never, admins).forHome("home-admin-space"),
    ).toBe(false);
    expect(await hostComputerGate(database() as never).forHome("home-admin-space")).toBe(false);
    expect(await hostComputerGate(database() as never, admins).forHome(undefined)).toBe(false);
  });

  it("keeps the desktop app's single account on this computer", async () => {
    const gate = hostComputerGate(database() as never, { adminEmails: [], singleAccount: true });
    expect(await gate.forHome("home-member-space")).toBe(true);
    expect(await gate.forHome(undefined)).toBe(true);
    expect(
      await hostComputerGate(database("docker") as never, {
        adminEmails: [],
        singleAccount: true,
      }).forHome(undefined),
    ).toBe(false);
  });
});

describe("routing computers between this computer and isolated ones", () => {
  async function sandbox() {
    return createRunSandbox("docker", {
      prisma: database() as unknown as PrismaClient,
      hostComputerAccess: admins,
    });
  }

  it("provisions an admin-owned space on this computer and everyone else isolated", async () => {
    const isolated = vi
      .spyOn(DockerSandboxProvider.prototype, "provision")
      .mockImplementation(async (request) => ({
        id: "isolated",
        botId: request.botId,
        kind: "docker",
        providerRef: "container",
      }));
    const host = vi
      .spyOn(HostComputerSandbox.prototype, "provision")
      .mockImplementation(async (request) => ({
        id: "host",
        botId: request.botId,
        kind: "desktop",
        providerRef: "host",
      }));
    const routed = await sandbox();

    expect(await routed.provisionKind?.("home-admin-space")).toBe("desktop");
    expect(await routed.provisionKind?.("home-member-space")).toBe("docker");
    expect(await routed.provisionKind?.("home-mixed-space")).toBe("docker");

    expect(
      (await routed.provision({ botId: "home-admin-space", homePath: "/home" }, ctx)).kind,
    ).toBe("desktop");
    expect(host).toHaveBeenCalledOnce();
    expect(isolated).not.toHaveBeenCalled();

    expect(
      (await routed.provision({ botId: "home-member-space", homePath: "/home" }, ctx)).kind,
    ).toBe("docker");
    expect(isolated).toHaveBeenCalledOnce();
    expect(host).toHaveBeenCalledOnce();
  });

  it("does not report a non-admin's old host computer as running", async () => {
    const running = vi.spyOn(HostComputerSandbox.prototype, "isRunning").mockResolvedValue(true);
    const routed = await sandbox();
    expect(await routed.isRunning?.(desktopComputer("member-space"), ctx)).toBe(false);
    expect(await routed.isRunning?.(desktopComputer("admin-space"), ctx)).toBe(true);
    expect(running).toHaveBeenCalledOnce();
  });

  it("refuses commands, files, screen and terminal on this computer to a non-admin's computer", async () => {
    const host = new FakeSandboxProvider();
    const spies = [
      vi.spyOn(host, "execute"),
      vi.spyOn(host, "readFile"),
      vi.spyOn(host, "writeFile"),
      vi.spyOn(host, "listFiles"),
      vi.spyOn(host, "act"),
      vi.spyOn(host, "observe"),
      vi.spyOn(host, "connectScreen"),
      vi.spyOn(host, "prepare"),
    ];
    const gate = hostComputerGate(database() as never, admins);
    const routed = new HostAwareSandbox(new FakeSandboxProvider(), host, gate);
    const computer = desktopComputer("member-space");
    const refused = "Local computer access is disabled";

    await expect(drain(routed.execute(computer, { argv: ["id"] }, ctx))).rejects.toThrow(refused);
    await expect(routed.readFile(computer, "/etc/hosts", ctx)).rejects.toThrow(refused);
    await expect(
      routed.writeFile(computer, { path: "x", content: new Uint8Array() }, ctx),
    ).rejects.toThrow(refused);
    await expect(routed.listFiles(computer, "/", ctx)).rejects.toThrow(refused);
    await expect(routed.observe(computer, ctx)).rejects.toThrow(refused);
    await expect(routed.prepare(computer, ctx)).rejects.toThrow(refused);
    await expect(drain(routed.exportWorkspace(computer, ctx))).rejects.toThrow(refused);
    await expect(
      routed.connectTerminal(computer, { cols: 80, rows: 24 } as never, ctx),
    ).rejects.toThrow(refused);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("still runs commands on this computer for an admin-owned space", async () => {
    const host = new FakeSandboxProvider();
    const gate = hostComputerGate(database() as never, admins);
    const routed = new HostAwareSandbox(new FakeSandboxProvider(), host, gate);
    const computer = await host.provision({ botId: "home-admin-space", homePath: "/home" }, ctx);
    const execute = vi.spyOn(host, "execute");
    await drain(routed.execute({ ...computer, kind: "desktop" }, { argv: ["true"] }, ctx));
    expect(execute).toHaveBeenCalledOnce();
  });
});
