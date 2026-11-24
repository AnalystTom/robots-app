import type { EmailMessage, EmailSummary } from "@robots/contracts";
import { IsolationError } from "@robots/db";
import type { RouterContext } from "./context.js";

/** Messages one page of a mailbox lists. */
export const EMAIL_PAGE_SIZE = 30;
const PREVIEW_CHARS = 160;

type StoredFile = { name: string; artifactId?: string };

type Row = {
  id: string;
  botId: string;
  sent: boolean;
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  text: string;
  verified: boolean;
  receivedAt: Date;
  attachments: unknown;
};

const SUMMARY_SELECT = {
  id: true,
  botId: true,
  sent: true,
  fromName: true,
  fromAddress: true,
  to: true,
  subject: true,
  text: true,
  verified: true,
  receivedAt: true,
  attachments: true,
} as const;

function filesOf(row: Row): StoredFile[] {
  return Array.isArray(row.attachments) ? (row.attachments as StoredFile[]) : [];
}

function toSummary(row: Row): EmailSummary {
  return {
    id: row.id,
    botId: row.botId,
    sent: row.sent,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    to: row.to,
    subject: row.subject,
    preview: row.text
      .slice(0, PREVIEW_CHARS * 2)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PREVIEW_CHARS),
    verified: row.verified,
    receivedAt: row.receivedAt.toISOString(),
    fileCount: filesOf(row).length,
  };
}

/**
 * A bot's inbox is its owner's mail: like `bots.emailAddress`, only the owner sees it, and only
 * for their bots in the current Space. Anyone else's bot or message reads as not found.
 */
export function emailRoutes(ctx: RouterContext) {
  const { deps, emailEnabled } = ctx;
  return {
    email: {
      mailboxes: emailEnabled.email.mailboxes.handler(async ({ context }) => {
        const domain = deps.env.inboundEmailDomain ?? null;
        if (!domain) return { domain, mailboxes: [] };
        const bots = await deps.prisma.bot.findMany({
          // Archived bots receive no mail.
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            archivedAt: null,
          },
          select: { id: true, name: true, emailAddress: { select: { name: true } } },
          orderBy: { name: "asc" },
        });
        return {
          domain,
          mailboxes: bots.map((bot) => ({
            botId: bot.id,
            botName: bot.name,
            address: bot.emailAddress ? `${bot.emailAddress.name}@${domain}` : null,
          })),
        };
      }),
      messages: emailEnabled.email.messages.handler(async ({ context, input }) => {
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId, userId: context.actor.userId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        const rows = await deps.prisma.botEmailMessage.findMany({
          where: { botId: bot.id, spaceId: context.actor.spaceId, sent: input.folder === "sent" },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          take: EMAIL_PAGE_SIZE + 1,
          select: SUMMARY_SELECT,
        });
        const page = rows.slice(0, EMAIL_PAGE_SIZE);
        return {
          messages: page.map(toSummary),
          nextCursor: rows.length > EMAIL_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
        };
      }),
      message: emailEnabled.email.message.handler(
        async ({ context, input }): Promise<EmailMessage> => {
          const row = await deps.prisma.botEmailMessage.findFirst({
            where: {
              id: input.id,
              spaceId: context.actor.spaceId,
              bot: { userId: context.actor.userId },
            },
            select: { ...SUMMARY_SELECT, cc: true },
          });
          if (!row) throw new IsolationError();
          return {
            ...toSummary(row),
            cc: row.cc,
            text: row.text,
            files: filesOf(row).map((file) => ({
              name: file.name,
              kept: Boolean(file.artifactId),
            })),
          };
        },
      ),
    },
  };
}
