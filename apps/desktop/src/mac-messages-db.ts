import { closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const APPLE_EPOCH_SECONDS = 978_307_200;
const UNIX_SECONDS = (column: string) =>
  `(CASE WHEN ${column} > 100000000000 THEN ${column} / 1000000000 ELSE ${column} END + ${APPLE_EPOCH_SECONDS})`;

export interface MessagesChat {
  id: number;
  guid: string;
  name: string | null;
  participants: string[];
  service: string | null;
  last_message_at: string | null;
}

export interface MessagesMessage {
  id: number;
  from: string;
  text: string;
  at: string | null;
  has_attachments: boolean;
}

export function chatDatabaseAccess(file: string): string | undefined {
  try {
    closeSync(openSync(file, "r"));
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? "EIO";
  }
}

export function openChatDatabase(file: string) {
  return new DatabaseSync(file, { readOnly: true });
}

type Database = Pick<DatabaseSync, "prepare">;

function isoFromUnix(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > APPLE_EPOCH_SECONDS
    ? new Date(value * 1000).toISOString()
    : null;
}

export function listChats(db: Database, limit: number): MessagesChat[] {
  const rows = db
    .prepare(
      `SELECT c.ROWID AS id, c.guid, c.chat_identifier, c.display_name, c.service_name,
        MAX(${UNIX_SECONDS("m.date")}) AS last_at,
        (SELECT group_concat(h.id, char(31)) FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS participants
       FROM chat c
       JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
       JOIN message m ON m.ROWID = cmj.message_id
       GROUP BY c.ROWID
       ORDER BY last_at DESC
       LIMIT ?`,
    )
    .all(limit);
  return rows.map((row) => ({
    id: Number(row.id),
    guid: String(row.guid),
    name: (row.display_name as string | null) || (row.chat_identifier as string | null) || null,
    participants: row.participants ? String(row.participants).split("\u001f") : [],
    service: (row.service_name as string | null) ?? null,
    last_message_at: isoFromUnix(row.last_at),
  }));
}

export function readChat(
  db: Database,
  input: { chat_id: number; limit: number; before?: string },
): { chat: MessagesChat | null; messages: MessagesMessage[] } {
  const chat = listChatById(db, input.chat_id);
  if (!chat) return { chat: null, messages: [] };
  const before = input.before ? Date.parse(input.before) / 1000 : null;
  const rows = db
    .prepare(
      `SELECT m.ROWID AS id, m.text, m.attributedBody, m.is_from_me, m.cache_has_attachments,
        ${UNIX_SECONDS("m.date")} AS at, h.id AS sender
       FROM chat_message_join cmj
       JOIN message m ON m.ROWID = cmj.message_id
       LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE cmj.chat_id = ?
         AND COALESCE(m.associated_message_type, 0) = 0
         AND (? IS NULL OR ${UNIX_SECONDS("m.date")} < ?)
       ORDER BY m.date DESC, m.ROWID DESC
       LIMIT ?`,
    )
    .all(input.chat_id, before, before, input.limit);
  const messages = rows.reverse().map((row) => ({
    id: Number(row.id),
    from: Number(row.is_from_me) === 1 ? "me" : String(row.sender ?? "unknown"),
    text:
      (typeof row.text === "string" && row.text) ||
      decodeAttributedBody(row.attributedBody as Uint8Array | null) ||
      "",
    at: isoFromUnix(row.at),
    has_attachments: Number(row.cache_has_attachments) === 1,
  }));
  return { chat, messages };
}

function listChatById(db: Database, chatId: number): MessagesChat | null {
  const row = db
    .prepare(
      `SELECT c.ROWID AS id, c.guid, c.chat_identifier, c.display_name, c.service_name,
        (SELECT group_concat(h.id, char(31)) FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS participants
       FROM chat c WHERE c.ROWID = ?`,
    )
    .get(chatId);
  if (!row) return null;
  return {
    id: Number(row.id),
    guid: String(row.guid),
    name: (row.display_name as string | null) || (row.chat_identifier as string | null) || null,
    participants: row.participants ? String(row.participants).split("\u001f") : [],
    service: (row.service_name as string | null) ?? null,
    last_message_at: null,
  };
}

const NSSTRING = Buffer.from("NSString");

export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob) return null;
  const bytes = Buffer.from(blob);
  const marker = bytes.indexOf(NSSTRING);
  if (marker < 0) return null;
  const plus = bytes.indexOf(0x2b, marker + NSSTRING.length);
  if (plus < 0 || plus > marker + NSSTRING.length + 8) return null;
  let at = plus + 1;
  let length = bytes[at];
  if (length === undefined) return null;
  at += 1;
  if (length === 0x81) {
    if (at + 2 > bytes.length) return null;
    length = bytes.readUInt16LE(at);
    at += 2;
  } else if (length === 0x82) {
    if (at + 4 > bytes.length) return null;
    length = bytes.readUInt32LE(at);
    at += 4;
  }
  if (at + length > bytes.length) return null;
  return bytes.toString("utf8", at, at + length);
}
