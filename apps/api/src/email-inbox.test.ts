import { createRouterClient } from "@orpc/server";
import type { Actor } from "@robots/contracts";
import { IsolationError } from "@robots/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { EMAIL_PAGE_SIZE } from "./routes/email.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@robots.test",
  isDeploymentOwner: false,
};

type Row = Record<string, unknown>;

function stored(id: string, overrides: Row = {}): Row {
  return {
    id,
    botId: "bot-1",
    spaceId: "space-1",
    ownerId: "user-1",
    sent: false,
    fromName: "Ada",
    fromAddress: "ada@example.test",
    to: ["helper@mail.example.test"],
    cc: [],
    subject: `Subject ${id}`,
    text: "Hello\n\n  there,   friend",
    verified: true,
    receivedAt: new Date("2026-11-01T00:00:00.000Z"),
    attachments: [],
    ...overrides,
  };
}

function inboxDeps({
  labs = ["email"],
  domain = "mail.example.test" as string | null,
  messages = [] as Row[],
} = {}) {
  const bots = [
    { id: "bot-1", name: "Helper", spaceId: "space-1", userId: "user-1", archivedAt: null },
    { id: "bot-2", name: "Other", spaceId: "space-1", userId: "user-2", archivedAt: null },
  ];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ labs })) },
    bot: {
      findMany: vi.fn(async () => [
        { id: "bot-1", name: "Helper", emailAddress: { name: "helper" } },
        { id: "bot-3", name: "Quiet", emailAddress: null },
      ]),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const bot = bots.find((row) => matches(row, where));
        return bot ? { id: bot.id } : null;
      }),
    },
    botEmailMessage: {
      findMany: vi.fn(
        async ({
          where,
          cursor,
          skip = 0,
          take,
        }: {
          where: Row;
          cursor?: { id: string };
          skip?: number;
          take: number;
        }) => {
          const rows = messages.filter((row) => matches(row, where));
          const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
          return rows.slice(start, start + take);
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: Row & { bot: { userId: string } } }) => {
        const { bot, ...rest } = where;
        return messages.find((row) => matches(row, rest) && row.ownerId === bot.userId) ?? null;
      }),
    },
  };
  const client = createRouterClient(
    createRouter({
      prisma,
      env: { inboundEmailDomain: domain ?? undefined },
    } as unknown as RouterDeps),
    { context: { actor } },
  );
  return { client, prisma };
}

describe("email reads", () => {
  it("refuses every read when the account hasn't turned Email on", async () => {
    const { client, prisma } = inboxDeps({ labs: [] });
    await expect(client.email.mailboxes()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.email.messages({ botId: "bot-1", folder: "inbox" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(client.email.message({ id: "m-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(prisma.bot.findMany).not.toHaveBeenCalled();
    expect(prisma.botEmailMessage.findMany).not.toHaveBeenCalled();
  });

  it("lists the caller's own active bots with their addresses", async () => {
    const { client, prisma } = inboxDeps();
    await expect(client.email.mailboxes()).resolves.toEqual({
      domain: "mail.example.test",
      mailboxes: [
        { botId: "bot-1", botName: "Helper", address: "helper@mail.example.test" },
        { botId: "bot-3", botName: "Quiet", address: null },
      ],
    });
    expect(prisma.bot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: "space-1", userId: "user-1", archivedAt: null },
      }),
    );
  });

  it("says so when the server receives no email", async () => {
    const { client, prisma } = inboxDeps({ domain: null });
    await expect(client.email.mailboxes()).resolves.toEqual({ domain: null, mailboxes: [] });
    expect(prisma.bot.findMany).not.toHaveBeenCalled();
  });

  it("pages a mailbox's folder newest first", async () => {
    const messages = Array.from({ length: EMAIL_PAGE_SIZE + 2 }, (_, index) =>
      stored(`m-${index}`),
    );
    messages.push(stored("sent-1", { sent: true }));
    const { client, prisma } = inboxDeps({ messages });

    const first = await client.email.messages({ botId: "bot-1", folder: "inbox" });
    expect(first.messages).toHaveLength(EMAIL_PAGE_SIZE);
    expect(first.messages[0]).toEqual({
      id: "m-0",
      botId: "bot-1",
      sent: false,
      fromName: "Ada",
      fromAddress: "ada@example.test",
      to: ["helper@mail.example.test"],
      subject: "Subject m-0",
      preview: "Hello there, friend",
      verified: true,
      receivedAt: "2026-11-01T00:00:00.000Z",
      fileCount: 0,
    });
    expect(first.nextCursor).toBe(`m-${EMAIL_PAGE_SIZE - 1}`);
    expect(prisma.botEmailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { botId: "bot-1", spaceId: "space-1", sent: false },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      }),
    );

    const second = await client.email.messages({
      botId: "bot-1",
      folder: "inbox",
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.messages.map((message) => message.id)).toEqual([
      `m-${EMAIL_PAGE_SIZE}`,
      `m-${EMAIL_PAGE_SIZE + 1}`,
    ]);
    expect(second.nextCursor).toBeNull();

    const sent = await client.email.messages({ botId: "bot-1", folder: "sent" });
    expect(sent.messages.map((message) => message.id)).toEqual(["sent-1"]);
  });

  it("treats another member's bot as not found", async () => {
    const { client, prisma } = inboxDeps({ messages: [stored("m-1", { botId: "bot-2" })] });
    await expect(client.email.messages({ botId: "bot-2", folder: "inbox" })).rejects.toBeInstanceOf(
      IsolationError,
    );
    expect(prisma.botEmailMessage.findMany).not.toHaveBeenCalled();
  });

  it("reads a whole message, and only the caller's own in this Space", async () => {
    const { client, prisma } = inboxDeps({
      messages: [
        stored("m-1", {
          cc: ["cc@example.test"],
          verified: false,
          attachments: [{ name: "a.pdf", artifactId: "artifact-1" }, { name: "b.exe" }],
        }),
        stored("m-2", { botId: "bot-2", ownerId: "user-2" }),
        stored("m-3", { spaceId: "space-2" }),
      ],
    });
    await expect(client.email.message({ id: "m-1" })).resolves.toMatchObject({
      id: "m-1",
      cc: ["cc@example.test"],
      text: "Hello\n\n  there,   friend",
      verified: false,
      fileCount: 2,
      files: [
        { name: "a.pdf", kept: true },
        { name: "b.exe", kept: false },
      ],
    });
    expect(prisma.botEmailMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m-1", spaceId: "space-1", bot: { userId: "user-1" } },
      }),
    );
    await expect(client.email.message({ id: "m-2" })).rejects.toBeInstanceOf(IsolationError);
    await expect(client.email.message({ id: "m-3" })).rejects.toBeInstanceOf(IsolationError);
  });
});
