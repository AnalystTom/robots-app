import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@robots/contracts";
import type { PrismaClient } from "@robots/db";
import { recordSecurityEvent } from "@robots/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

vi.mock("@robots/db", async (original) => ({
  ...(await original<typeof import("@robots/db")>()),
  recordSecurityEvent: vi.fn(async () => undefined),
}));

// Offline boundary: a fake session table and auth drive the real router handlers.

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@robots.test",
  isDeploymentOwner: false,
} satisfies Actor;

type Row = {
  id: string;
  token: string;
  userId: string;
  pairedDevice: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

const day = 24 * 60 * 60_000;
const row = (id: string, patch: Partial<Row> = {}): Row => ({
  id,
  token: `token-${id}`,
  userId: "user-1",
  pairedDevice: "Phone",
  userAgent: "Mozilla/5.0 (iPhone)",
  ipAddress: "192.168.1.20",
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
  expiresAt: new Date(Date.now() + day),
  ...patch,
});

type Where = {
  userId: string;
  pairedDevice?: { not: null };
  expiresAt?: { gt: Date };
  id?: string | { not?: string };
};

function matches(session: Row, where: Where) {
  if (session.userId !== where.userId) return false;
  if (where.pairedDevice && session.pairedDevice === null) return false;
  if (where.expiresAt && session.expiresAt <= where.expiresAt.gt) return false;
  if (typeof where.id === "string" && session.id !== where.id) return false;
  if (typeof where.id === "object" && where.id.not !== undefined && session.id === where.id.not)
    return false;
  return true;
}

function fixture(sessions: Row[]) {
  const prisma = {
    session: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        sessions.filter((session) => matches(session, where)),
      ),
    },
  };
  const auth = {
    issuePairingCode: vi.fn(async () => ({
      code: "ABCDEFGHJKMN",
      expiresAt: new Date("2026-11-15T10:05:00Z"),
    })),
    endSessions: vi.fn(async (tokens: string[]) => {
      for (const token of tokens)
        sessions.splice(
          sessions.findIndex((session) => session.token === token),
          1,
        );
    }),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    auth,
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/robots-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(
    path: "create" | "devices" | "revoke" | "revokeOthers",
    json: unknown = undefined,
    context: { actor: Actor | null; sessionId?: string } = { actor, sessionId: "current" },
  ) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/devicePairing/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json === undefined ? {} : { json }),
      }),
      { prefix: "/rpc", context },
    );
    if (!response) throw new Error("Procedure did not match");
    return { status: response.status, body: (await response.json()) as { json: unknown } };
  }
  return { call, auth, sessions };
}

beforeEach(() => vi.mocked(recordSecurityEvent).mockClear());

describe("devicePairing procedures", () => {
  it("needs a signed-in account", async () => {
    const f = fixture([]);
    expect((await f.call("create", undefined, { actor: null })).status).toBe(401);
    expect(f.auth.issuePairingCode).not.toHaveBeenCalled();
  });

  it("issues a code for the caller and audits it without the code", async () => {
    const f = fixture([]);
    const created = await f.call("create");
    expect(created.status).toBe(200);
    expect(created.body.json).toEqual({
      code: "ABCDEFGHJKMN",
      expiresAt: "2026-11-15T10:05:00.000Z",
    });
    expect(f.auth.issuePairingCode).toHaveBeenCalledWith("user-1");
    const events = JSON.stringify(vi.mocked(recordSecurityEvent).mock.calls);
    expect(events).toContain("pairing_code");
    expect(events).not.toContain("ABCDEFGHJKMN");
  });

  it("lists only the caller's live paired sessions, without tokens", async () => {
    const f = fixture([
      row("current", { pairedDevice: "" }),
      row("phone"),
      row("browser-sign-in", { pairedDevice: null }),
      row("expired", { expiresAt: new Date(Date.now() - 1) }),
      row("someone-else", { userId: "user-2" }),
    ]);
    const { body } = await f.call("devices");
    expect(body.json).toEqual([
      expect.objectContaining({ id: "current", name: "", current: true }),
      {
        id: "phone",
        name: "Phone",
        userAgent: "Mozilla/5.0 (iPhone)",
        ipAddress: "192.168.1.20",
        pairedAt: "2026-11-01T10:00:00.000Z",
        lastSeenAt: "2026-11-02T10:00:00.000Z",
        current: false,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("token-");
  });

  it("revokes one paired device of the caller's, and nothing else", async () => {
    const f = fixture([
      row("phone"),
      row("browser", { pairedDevice: null }),
      row("other", { userId: "user-2" }),
    ]);
    expect((await f.call("revoke", { id: "browser" })).status).toBe(404);
    expect((await f.call("revoke", { id: "other" })).status).toBe(404);
    expect(f.auth.endSessions).not.toHaveBeenCalled();
    expect((await f.call("revoke", { id: "phone" })).status).toBe(200);
    expect(f.auth.endSessions).toHaveBeenCalledWith(["token-phone"]);
    expect(vi.mocked(recordSecurityEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth.session.revoked",
        metadata: expect.objectContaining({ id: "phone" }),
      }),
    );
  });

  it("revokes every other paired device and keeps the caller's own", async () => {
    const f = fixture([
      row("current"),
      row("phone"),
      row("tablet"),
      row("browser", { pairedDevice: null }),
    ]);
    const { body } = await f.call("revokeOthers");
    expect(body.json).toEqual({ revoked: 2 });
    expect(f.sessions.map((session) => session.id)).toEqual(["current", "browser"]);
  });
});
