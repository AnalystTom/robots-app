import type { ConnectorTool } from "@robots/adapter-kit";
import type { MacAppToolName } from "@robots/contracts";
import { MAC_APP_TOOL_NAMES, macAppToolEntry } from "@robots/contracts";
import { z } from "zod";

const CONTROL_CHARACTERS = /[^\P{Cc}\t\n\r]/u;
const LINE_BREAKS = /[\r\n\u2028\u2029]/;

const text = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARACTERS.test(value), "must not contain control characters");
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !CONTROL_CHARACTERS.test(value) && !LINE_BREAKS.test(value),
      "must be a single line",
    );
const limit = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`At most ${max}.`);
const isoTime = z.iso
  .datetime({ offset: true })
  .describe("ISO 8601 date and time with an offset, like 2026-11-21T09:00:00-08:00.");
const email = z
  .string()
  .trim()
  .max(254)
  .regex(
    /^[^\s@<>,;"'()[\]\\]+@[^\s@<>,;"'()[\]\\]+\.[^\s@<>,;"'()[\]\\]+$/,
    "must be an email address",
  );
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ().-]{2,30}$/, "must be a phone number");
const handle = z.union([phone, email]);
const mailbox = z
  .enum(["inbox", "sent", "drafts", "junk", "trash"])
  .default("inbox")
  .describe("Which mailbox, across all accounts.");
const maxChars = z.number().int().min(200).max(50_000).default(20_000);

const noteId = z
  .string()
  .regex(
    /^x-coredata:\/\/[A-Za-z0-9-]{1,64}\/ICNote\/p[0-9]{1,12}$/,
    "must be a note id from search",
  );
const reminderId = z
  .string()
  .regex(/^x-apple-reminder:\/\/[A-Za-z0-9-]{1,64}$/, "must be a reminder id from the list");
const contactId = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}(:ABPerson)?$/, "must be a contact id from search");
const chatGuid = z
  .string()
  .regex(
    /^(iMessage|SMS|RCS|any);[-+];[A-Za-z0-9@.+_:-]{1,200}$/,
    "must be a chat guid from mac_messages_chats",
  );

const DAY_MS = 86_400_000;

const outgoingEmail = z.object({
  to: z.array(email).min(1).max(20),
  cc: z.array(email).max(20).default([]),
  bcc: z.array(email).max(20).default([]),
  subject: line(500),
  body: text(100_000),
});

export const MAC_APP_TOOL_ARGS = {
  mac_mail_search: z.object({
    query: line(200).optional().describe("Words in the subject or sender. Omit for the newest."),
    mailbox,
    unread_only: z.boolean().default(false),
    limit: limit(50, 20),
  }),
  mac_mail_read: z.object({
    id: z.number().int().positive().describe("Message id from mac_mail_search."),
    mailbox,
    max_chars: maxChars,
  }),
  mac_mail_draft: outgoingEmail,
  mac_mail_send: outgoingEmail,
  mac_messages_chats: z.object({ limit: limit(50, 20) }),
  mac_messages_read: z.object({
    chat_id: z.number().int().positive().describe("Chat id from mac_messages_chats."),
    limit: limit(200, 50),
    before: isoTime.optional().describe("Only messages before this time, to page back."),
  }),
  mac_messages_send: z
    .object({
      to: handle.optional().describe("A phone number or email address."),
      chat_guid: chatGuid.optional().describe("An existing chat, from mac_messages_chats."),
      text: text(4_000, 1),
    })
    .refine((value) => (value.to === undefined) !== (value.chat_guid === undefined), {
      message: "give exactly one of to or chat_guid",
    }),
  mac_notes_search: z.object({ query: line(200), limit: limit(50, 20) }),
  mac_notes_read: z.object({ id: noteId, max_chars: maxChars }),
  mac_notes_create: z.object({
    title: line(200),
    body: text(50_000).default(""),
    folder: line(100).optional().describe("Folder name. Omit for the default folder."),
  }),
  mac_notes_append: z.object({ id: noteId, text: text(50_000, 1) }),
  mac_reminders_list: z.object({
    list: line(100).optional().describe("List name. Omit to see every list and open reminders."),
    include_completed: z.boolean().default(false),
    limit: limit(100, 50),
  }),
  mac_reminders_create: z.object({
    title: line(300),
    list: line(100).optional(),
    due: isoTime.optional(),
    notes: text(5_000).optional(),
  }),
  mac_reminders_complete: z.object({ id: reminderId }),
  mac_calendar_events: z
    .object({
      from: isoTime,
      to: isoTime,
      calendar: line(100).optional().describe("Calendar name. Omit for every calendar."),
      limit: limit(200, 100),
    })
    .refine(
      (value) => {
        const span = Date.parse(value.to) - Date.parse(value.from);
        return span > 0 && span <= 92 * DAY_MS;
      },
      { message: "to must be after from and at most 92 days later" },
    ),
  mac_calendar_create_event: z
    .object({
      title: line(300),
      start: isoTime,
      end: isoTime,
      calendar: line(100).optional(),
      location: line(500).optional(),
      notes: text(5_000).optional(),
      all_day: z.boolean().default(false),
    })
    .refine((value) => Date.parse(value.end) >= Date.parse(value.start), {
      message: "end must not be before start",
    }),
  mac_contacts_search: z.object({ query: line(200), limit: limit(50, 20) }),
  mac_contacts_read: z.object({ id: contactId }),
  mac_location_current: z.object({}),
} satisfies Record<MacAppToolName, z.ZodType>;

export type MacAppToolArgs = { [K in MacAppToolName]: z.output<(typeof MAC_APP_TOOL_ARGS)[K]> };

const DESCRIPTIONS: Record<MacAppToolName, string> = {
  mac_mail_search:
    "Search email in Mail on the user's Mac. Returns the newest matching messages with id, subject, sender, date and read state.",
  mac_mail_read: "Read one email from Mail on the user's Mac, by the id mac_mail_search returned.",
  mac_mail_draft:
    "Write an email draft in Mail on the user's Mac and leave it open for them to review. Nothing is sent.",
  mac_mail_send:
    "Send an email from Mail on the user's Mac. The user approves every email before it is sent, with exactly these recipients, subject and body.",
  mac_messages_chats:
    "List the user's most recent chats in Messages on their Mac, with chat id, guid, name, participants and last activity.",
  mac_messages_read:
    "Read the latest messages of one chat in Messages on the user's Mac, oldest first.",
  mac_messages_send:
    "Send a message with Messages on the user's Mac, to a phone number or email or an existing chat. The user approves every message before it is sent.",
  mac_notes_search: "Search notes in Notes on the user's Mac by title or text.",
  mac_notes_read:
    "Read one note from Notes on the user's Mac, by the id mac_notes_search returned.",
  mac_notes_create: "Create a note in Notes on the user's Mac. body is plain text.",
  mac_notes_append: "Add plain text to the end of a note in Notes on the user's Mac.",
  mac_reminders_list:
    "List reminder lists and reminders in Reminders on the user's Mac, with ids, due dates and completion.",
  mac_reminders_create: "Add a reminder in Reminders on the user's Mac.",
  mac_reminders_complete: "Mark a reminder done in Reminders on the user's Mac.",
  mac_calendar_events:
    "List events between two times in Calendar on the user's Mac. Repeating events show only their first occurrence.",
  mac_calendar_create_event:
    "Add an event to Calendar on the user's Mac. The user approves each event before it is added.",
  mac_contacts_search: "Search people in Contacts on the user's Mac by name or company.",
  mac_contacts_read:
    "Read one person's emails, phone numbers, addresses and notes from Contacts on the user's Mac.",
  mac_location_current:
    "Get the user's current location from their Mac, as latitude, longitude and accuracy in meters.",
};

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return json;
}

export const macAppAgentTools: ConnectorTool[] = MAC_APP_TOOL_NAMES.map((name) => {
  const entry = macAppToolEntry(name)!;
  return {
    name,
    description: DESCRIPTIONS[name],
    inputSchema: inputSchema(MAC_APP_TOOL_ARGS[name]),
    readOnly: entry.tool.kind === "read",
    label: `${entry.app.name}: ${entry.tool.label}`,
  };
});
