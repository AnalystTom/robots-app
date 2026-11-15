import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** One of the caller's own bots on the Email page; `address` is null until the owner claims one. */
export const EmailMailboxSchema = z.object({
  botId: Id,
  botName: z.string(),
  address: z.string().nullable(),
});
export type EmailMailbox = z.infer<typeof EmailMailboxSchema>;

/** The caller's bots in this Space; `domain` is null when this server receives no email. */
export const EmailMailboxesSchema = z.object({
  domain: z.string().nullable(),
  mailboxes: z.array(EmailMailboxSchema),
});
export type EmailMailboxes = z.infer<typeof EmailMailboxesSchema>;

/** Mail the bot received, or mail it sent. */
export const EmailFolderSchema = z.enum(["inbox", "sent"]);
export type EmailFolder = z.infer<typeof EmailFolderSchema>;

export const EmailSummarySchema = z.object({
  id: Id,
  botId: Id,
  sent: z.boolean(),
  fromName: z.string(),
  fromAddress: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  /** The start of the text, on one line. */
  preview: z.string(),
  /** Signed by the sender's own domain; mail that isn't may be forged. */
  verified: z.boolean(),
  receivedAt: IsoDate,
  fileCount: z.number().int(),
});
export type EmailSummary = z.infer<typeof EmailSummarySchema>;

export const EmailMessagesInput = z.object({
  botId: Id,
  folder: EmailFolderSchema,
  /** The last id of the previous page. */
  cursor: Id.optional(),
});

export const EmailMessagesPageSchema = z.object({
  messages: z.array(EmailSummarySchema),
  /** Null on the last page. */
  nextCursor: Id.nullable(),
});
export type EmailMessagesPage = z.infer<typeof EmailMessagesPageSchema>;

/** A whole message. Its text is the sender's plain text, shown as text and never as markup. */
export const EmailMessageSchema = EmailSummarySchema.extend({
  cc: z.array(z.string()),
  text: z.string(),
  /** File names; `kept` files were saved with the message, the others were refused. */
  files: z.array(z.object({ name: z.string(), kept: z.boolean() })),
});
export type EmailMessage = z.infer<typeof EmailMessageSchema>;
