import { createHash, randomUUID } from "node:crypto";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, AiConsentStatus } from "@robots/contracts";
import { AI_DISCLOSURE_VERSION } from "@robots/contracts";
import type { PrismaClient } from "@robots/db";
import { asSystem, createDb, createThreadEvents } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(databaseUrl);

describe.skipIf(!enabled)("AI data sharing consent per account and company (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let handler: RPCHandler<Record<string, unknown>>;
  const users: string[] = [];

  beforeAll(() => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      jobs: { enqueue: vi.fn(), cancel: vi.fn(), close: async () => undefined },
      secrets: { load: vi.fn() },
      sandbox: {},
      env: {
        agentRuntime: "pi",
        deploymentModelConfigured: true,
        defaultProvider: "openai-codex",
        defaultModel: "gpt-6-luna",
      },
    } as unknown as RouterDeps;
    handler = new RPCHandler(createRouter(deps));
  });
  afterAll(async () => {
    await system.organization.deleteMany({ where: { id: { in: users } } });
    await system.user.deleteMany({ where: { id: { in: users } } });
    await close?.();
  });

  async function account(): Promise<{ home: Actor; work: Actor }> {
    const id = `consent-${randomUUID()}`;
    users.push(id);
    const createdAt = new Date();
    await system.user.create({
      data: { id, name: "Consent", email: `${id}@example.test`, emailVerified: true },
    });
    await system.organization.create({ data: { id, name: "Personal", slug: id, createdAt } });
    await system.member.create({
      data: { id: `m-${id}`, organizationId: id, userId: id, role: "owner", createdAt },
    });
    const spaces = [id, `${id}-work`];
    for (const spaceId of spaces) {
      await system.space.create({
        data: {
          id: spaceId,
          organizationId: id,
          name: spaceId === id ? "Personal" : "Work",
          isDefault: spaceId === id,
          createdByUserId: id,
        },
      });
      await system.spaceMember.create({
        data: {
          id: `sm-${spaceId}`,
          spaceId,
          organizationId: id,
          userId: id,
          role: "owner",
          createdAt,
        },
      });
    }
    const actor = (spaceId: string) =>
      ({ userId: id, spaceId, email: `${id}@example.test`, isDeploymentOwner: false }) as Actor;
    return { home: actor(spaces[0]!), work: actor(spaces[1]!) };
  }

  async function call<T>(actor: Actor, path: string, input: unknown): Promise<T> {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/aiConsent/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    expect(response?.status).toBe(200);
    return ((await response!.json()) as { json: T }).json;
  }

  const status = (actor: Actor) => call<AiConsentStatus>(actor, "status", { uses: ["model"] });
  const recipient = (current: AiConsentStatus, name: string) =>
    current.recipients.find((entry) => entry.name === name);

  async function connectModel(actor: Actor, provider: string, modelId: string) {
    const credential = await system.userModelCredential.create({
      data: { userId: actor.userId, provider, label: provider, secretId: `secret-${provider}` },
    });
    await system.userModelPreference.create({
      data: { userId: actor.userId, credentialId: credential.id, modelId },
    });
  }

  it("asks once for OpenAI and honours it in every Space, model and session", async () => {
    const { home, work } = await account();
    const first = await status(home);
    const openai = recipient(first, "OpenAI");
    expect(openai).toMatchObject({ allowed: false, detail: "" });

    await call(home, "allow", {
      scope: first.scope,
      version: first.version,
      keys: [openai!.key],
    });

    await connectModel(home, "openai", "gpt-5");
    await connectModel(home, "anthropic", "claude-sonnet-5-5");
    const elsewhere = await status(work);
    expect(elsewhere.scope).toBe(first.scope);
    expect(elsewhere.recipients.filter((entry) => entry.name === "OpenAI")).toHaveLength(1);
    expect(recipient(elsewhere, "OpenAI")?.allowed).toBe(true);
    expect(recipient(elsewhere, "Anthropic")?.allowed).toBe(false);
  });

  it("keeps a grant saved for one model before grants covered the whole company", async () => {
    const { home, work } = await account();
    const legacyKey = createHash("sha256")
      .update(JSON.stringify(["model", "openai-codex", "", "gpt-6-luna"]))
      .digest("hex");
    await system.aiDataConsent.create({
      data: {
        userId: home.userId,
        spaceId: home.spaceId,
        recipientKey: legacyKey,
        version: AI_DISCLOSURE_VERSION,
      },
    });

    expect(recipient(await status(work), "OpenAI")?.allowed).toBe(true);

    const openai = recipient(await status(work), "OpenAI")!;
    const revoked = await call<AiConsentStatus>(work, "revoke", { key: openai.key });
    expect(recipient(revoked, "OpenAI")?.allowed).toBe(false);
    expect(recipient(await status(home), "OpenAI")?.allowed).toBe(false);
    expect(await system.aiDataConsent.count({ where: { userId: home.userId } })).toBe(0);
  });
});
