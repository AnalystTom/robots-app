import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import {
  chatDatabaseAccess,
  decodeAttributedBody,
  listChats,
  openChatDatabase,
  readChat,
} from "./mac-messages-db.js";

const CHAT_DB_SCHEMA = `
CREATE TABLE _SqliteDatabaseProperties (key TEXT, value TEXT, UNIQUE(key));
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, id TEXT NOT NULL, country TEXT, service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT, UNIQUE (id, service));
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER, state INTEGER, account_id TEXT, properties BLOB, chat_identifier TEXT, service_name TEXT, room_name TEXT, account_login TEXT, is_archived INTEGER DEFAULT 0, last_addressed_handle TEXT, display_name TEXT, group_id TEXT, is_filtered INTEGER DEFAULT 0, successful_query INTEGER, engram_id TEXT, server_change_token TEXT, ck_sync_state INTEGER DEFAULT 0, original_group_id TEXT, last_read_message_timestamp INTEGER DEFAULT 0, cloudkit_record_id TEXT, last_addressed_sim_id TEXT, is_blackholed INTEGER DEFAULT 0, syndication_date INTEGER DEFAULT 0, syndication_type INTEGER DEFAULT 0, is_recovered INTEGER DEFAULT 0, is_deleting_incoming_messages INTEGER DEFAULT 0);
CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, replace INTEGER DEFAULT 0, service_center TEXT, handle_id INTEGER DEFAULT 0, subject TEXT, country TEXT, attributedBody BLOB, version INTEGER DEFAULT 0, type INTEGER DEFAULT 0, service TEXT, account TEXT, account_guid TEXT, error INTEGER DEFAULT 0, date INTEGER, date_read INTEGER, date_delivered INTEGER, is_delivered INTEGER DEFAULT 0, is_finished INTEGER DEFAULT 0, is_emote INTEGER DEFAULT 0, is_from_me INTEGER DEFAULT 0, is_empty INTEGER DEFAULT 0, is_delayed INTEGER DEFAULT 0, is_auto_reply INTEGER DEFAULT 0, is_prepared INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, is_system_message INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0, has_dd_results INTEGER DEFAULT 0, is_service_message INTEGER DEFAULT 0, is_forward INTEGER DEFAULT 0, was_downgraded INTEGER DEFAULT 0, is_archive INTEGER DEFAULT 0, cache_has_attachments INTEGER DEFAULT 0, cache_roomnames TEXT, was_data_detected INTEGER DEFAULT 0, was_deduplicated INTEGER DEFAULT 0, is_audio_message INTEGER DEFAULT 0, is_played INTEGER DEFAULT 0, date_played INTEGER, item_type INTEGER DEFAULT 0, other_handle INTEGER DEFAULT 0, group_title TEXT, group_action_type INTEGER DEFAULT 0, share_status INTEGER DEFAULT 0, share_direction INTEGER DEFAULT 0, is_expirable INTEGER DEFAULT 0, expire_state INTEGER DEFAULT 0, message_action_type INTEGER DEFAULT 0, message_source INTEGER DEFAULT 0, associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0, balloon_bundle_id TEXT, payload_data BLOB, expressive_send_style_id TEXT, associated_message_range_location INTEGER DEFAULT 0, associated_message_range_length INTEGER DEFAULT 0, time_expressive_send_played INTEGER, message_summary_info BLOB, ck_sync_state INTEGER DEFAULT 0, ck_record_id TEXT, ck_record_change_tag TEXT, destination_caller_id TEXT, is_corrupt INTEGER DEFAULT 0, reply_to_guid TEXT, sort_id INTEGER, is_spam INTEGER DEFAULT 0, has_unseen_mention INTEGER DEFAULT 0, thread_originator_guid TEXT, thread_originator_part TEXT, syndication_ranges TEXT, synced_syndication_ranges TEXT, was_delivered_quietly INTEGER DEFAULT 0, did_notify_recipient INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0, date_edited INTEGER DEFAULT 0, was_detonated INTEGER DEFAULT 0, part_count INTEGER, is_stewie INTEGER DEFAULT 0, is_kt_verified INTEGER DEFAULT 0, is_sos INTEGER DEFAULT 0, is_critical INTEGER DEFAULT 0, bia_reference_id TEXT DEFAULT NULL, fallback_hash TEXT DEFAULT NULL);
CREATE TABLE chat_handle_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, handle_id INTEGER REFERENCES handle (ROWID) ON DELETE CASCADE, UNIQUE(chat_id, handle_id));
CREATE TABLE chat_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, message_date INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id));
CREATE INDEX chat_message_join_idx_message_date_id_chat_id ON chat_message_join(chat_id, message_date, message_id);
`;

const APPLE_EPOCH = Date.UTC(2001, 0, 1);
const appleNanos = (iso: string) => BigInt(Date.parse(iso) - APPLE_EPOCH) * 1_000_000n;

function attributedBody(text: string): Buffer {
  const utf8 = Buffer.from(text, "utf8");
  const length =
    utf8.length < 0x80
      ? Buffer.from([utf8.length])
      : Buffer.concat([Buffer.from([0x81]), Buffer.from([utf8.length & 0xff, utf8.length >> 8])]);
  return Buffer.concat([
    Buffer.from(
      "\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08",
      "latin1",
    ),
    Buffer.from("NSString"),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    length,
    utf8,
    Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49, 0x01]),
  ]);
}

const dir = mkdtempSync(path.join(tmpdir(), "robots-chatdb-"));
const file = path.join(dir, "chat.db");
const longText = `Long message ${"x".repeat(300)}`;
{
  const db = new DatabaseSync(file);
  db.exec(CHAT_DB_SCHEMA);
  db.exec(`
    INSERT INTO handle (ROWID, id, service) VALUES (1, '+15550100', 'iMessage'), (2, 'ana@example.test', 'iMessage');
    INSERT INTO chat (ROWID, guid, chat_identifier, service_name, display_name) VALUES
      (1, 'iMessage;-;+15550100', '+15550100', 'iMessage', ''),
      (2, 'iMessage;+;chat123', 'chat123', 'iMessage', 'Trip planning'),
      (3, 'SMS;-;+15550199', '+15550199', 'SMS', NULL);
    INSERT INTO chat_handle_join VALUES (1, 1), (2, 1), (2, 2);
  `);
  const insert = db.prepare(
    "INSERT INTO message (ROWID, guid, text, attributedBody, handle_id, date, is_from_me, cache_has_attachments, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(1, "m1", "Are we still on?", null, 1, appleNanos("2026-11-20T10:00:00Z"), 0, 0, 0);
  insert.run(
    2,
    "m2",
    null,
    attributedBody("Yes, see you at 5"),
    0,
    appleNanos("2026-11-20T10:01:00Z"),
    1,
    0,
    0,
  );
  insert.run(3, "m3", null, null, 1, appleNanos("2026-11-20T10:02:00Z"), 0, 0, 2001);
  insert.run(
    4,
    "m4",
    null,
    attributedBody(longText),
    2,
    appleNanos("2026-11-21T08:00:00Z"),
    0,
    1,
    0,
  );
  insert.run(
    5,
    "m5",
    "Old seconds-based row",
    null,
    1,
    (Date.parse("2016-01-01T00:00:00Z") - APPLE_EPOCH) / 1000,
    0,
    0,
    0,
  );
  const join = db.prepare(
    "INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)",
  );
  for (const [chat, message] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 4],
    [1, 5],
  ] as const)
    join.run(chat, message, 0);
  db.close();
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Messages history", () => {
  it("lists chats newest first with their people and leaves out chats with no messages", () => {
    const db = openChatDatabase(file);
    expect(listChats(db, 10)).toEqual([
      {
        id: 2,
        guid: "iMessage;+;chat123",
        name: "Trip planning",
        participants: ["+15550100", "ana@example.test"],
        service: "iMessage",
        last_message_at: "2026-11-21T08:00:00.000Z",
      },
      {
        id: 1,
        guid: "iMessage;-;+15550100",
        name: "+15550100",
        participants: ["+15550100"],
        service: "iMessage",
        last_message_at: "2026-11-20T10:02:00.000Z",
      },
    ]);
    expect(listChats(db, 1)).toHaveLength(1);
    db.close();
  });

  it("reads a chat oldest first, decoding rich text and skipping reactions", () => {
    const db = openChatDatabase(file);
    expect(readChat(db, { chat_id: 1, limit: 50 })).toEqual({
      chat: expect.objectContaining({ id: 1, guid: "iMessage;-;+15550100" }),
      messages: [
        {
          id: 5,
          from: "+15550100",
          text: "Old seconds-based row",
          at: "2016-01-01T00:00:00.000Z",
          has_attachments: false,
        },
        {
          id: 1,
          from: "+15550100",
          text: "Are we still on?",
          at: "2026-11-20T10:00:00.000Z",
          has_attachments: false,
        },
        {
          id: 2,
          from: "me",
          text: "Yes, see you at 5",
          at: "2026-11-20T10:01:00.000Z",
          has_attachments: false,
        },
      ],
    });
    expect(readChat(db, { chat_id: 2, limit: 50 }).messages).toEqual([
      expect.objectContaining({ from: "ana@example.test", text: longText, has_attachments: true }),
    ]);
    db.close();
  });

  it("pages back with before and limit", () => {
    const db = openChatDatabase(file);
    expect(
      readChat(db, { chat_id: 1, limit: 1, before: "2026-11-20T10:01:00Z" }).messages.map(
        (message) => message.id,
      ),
    ).toEqual([1]);
    expect(readChat(db, { chat_id: 1, limit: 2 }).messages.map((message) => message.id)).toEqual([
      1, 2,
    ]);
    expect(readChat(db, { chat_id: 99, limit: 5 })).toEqual({ chat: null, messages: [] });
    db.close();
  });

  it("opens the history read-only", () => {
    const db = openChatDatabase(file);
    expect(() => db.exec("DELETE FROM message")).toThrow(/readonly/i);
    db.close();
  });

  it("decodes only well-formed rich text", () => {
    expect(decodeAttributedBody(attributedBody("héllo"))).toBe("héllo");
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody(Buffer.from("no marker here"))).toBeNull();
    const truncated = attributedBody("a longer message body").subarray(0, -12);
    expect(decodeAttributedBody(truncated)).toBeNull();
  });

  it("tells a missing history from one it may not read", () => {
    expect(chatDatabaseAccess(file)).toBeUndefined();
    expect(chatDatabaseAccess(path.join(dir, "missing.db"))).toBe("ENOENT");
  });
});
