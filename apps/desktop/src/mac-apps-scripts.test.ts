import vm from "node:vm";
import { MAC_APP_TOOL_NAMES } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_PROBE_SCRIPT,
  LOCATION_STATUS_SCRIPT,
  MAC_APP_BUNDLES,
  MAC_TOOL_SCRIPTS,
} from "./mac-apps-scripts.js";

function runJxa(script: string, input: unknown, app: unknown) {
  const opened: string[] = [];
  const context = vm.createContext({
    Application: (id: string) => {
      opened.push(id);
      return app;
    },
    argv: [JSON.stringify(input)],
  });
  const output = vm.runInContext(`${script}\nrun(argv);`, context) as string;
  return { result: JSON.parse(output), opened };
}

describe("Mac app scripts", () => {
  it("has one fixed script per tool that reads arguments only from argv, and each compiles", () => {
    const scripted = Object.keys(MAC_TOOL_SCRIPTS);
    expect(scripted.sort()).toEqual(
      MAC_APP_TOOL_NAMES.filter(
        (name) => !name.startsWith("mac_messages_") || name === "mac_messages_send",
      ).sort(),
    );
    for (const script of [
      ...Object.values(MAC_TOOL_SCRIPTS),
      AUTOMATION_PROBE_SCRIPT,
      LOCATION_STATUS_SCRIPT,
    ]) {
      expect(() => new vm.Script(script)).not.toThrow();
      expect(script).toMatch(/function run\((argv)?\)/);
      expect(script).not.toMatch(/doShellScript|do shell script|eval\(/);
    }
  });

  it("escapes a note's title and body into the note's HTML", () => {
    const pushed: Array<{ body: string }> = [];
    const folder = { notes: { push: (note: { body: string }) => pushed.push(note) } };
    const notes = {
      folders: {
        whose: (query: { name: string }) => () => (query.name === "Work" ? [folder] : []),
      },
      defaultAccount: { defaultFolder: folder },
      Note: (properties: { body: string }) => ({
        ...properties,
        id: () => "x-coredata://A/ICNote/p9",
        name: () => "Title",
      }),
    };
    const { result, opened } = runJxa(
      MAC_TOOL_SCRIPTS.mac_notes_create,
      { title: `<img src=x onerror="alert(1)">`, body: "a & b\n\n</div>", folder: "Work" },
      notes,
    );
    expect(opened).toEqual([MAC_APP_BUNDLES.notes]);
    expect(result).toEqual({ id: "x-coredata://A/ICNote/p9", title: "Title" });
    expect(pushed[0]!.body).toBe(
      "<div><h1>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1></div><div>a &amp; b</div><div><br></div><div>&lt;/div&gt;</div>",
    );
    expect(() =>
      runJxa(MAC_TOOL_SCRIPTS.mac_notes_create, { title: "T", body: "", folder: "Missing" }, notes),
    ).toThrow("ROBOTS:not-found");
  });

  it("searches mail with the query as data and returns the newest first", () => {
    const filters: unknown[] = [];
    const messages = {
      id: () => [1, 2, 3],
      subject: () => ["Old invoice", "New invoice", "Mid invoice"],
      sender: () => ["a@x.test", "b@x.test", "c@x.test"],
      dateReceived: () => [
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-03-01T00:00:00Z"),
        new Date("2026-02-01T00:00:00Z"),
      ],
      readStatus: () => [true, false, true],
    };
    const mail = {
      inbox: {
        messages: {
          whose: (filter: unknown) => {
            filters.push(filter);
            return messages;
          },
        },
      },
    };
    const query = `"); Application("Finder").delete(`;
    const { result } = runJxa(
      MAC_TOOL_SCRIPTS.mac_mail_search,
      { query, mailbox: "inbox", unread_only: true, limit: 2 },
      mail,
    );
    expect(filters).toEqual([
      {
        _and: [
          { _or: [{ subject: { _contains: query } }, { sender: { _contains: query } }] },
          { readStatus: false },
        ],
      },
    ]);
    expect(result).toEqual({
      mailbox: "inbox",
      messages: [
        {
          id: 2,
          subject: "New invoice",
          sender: "b@x.test",
          date: "2026-03-01T00:00:00.000Z",
          read: false,
        },
        {
          id: 3,
          subject: "Mid invoice",
          sender: "c@x.test",
          date: "2026-02-01T00:00:00.000Z",
          read: true,
        },
      ],
    });
  });

  it("brings Mail forward and sends exactly the approved email", () => {
    const calls: unknown[] = [];
    const recipients = (kind: string) => ({
      push: (recipient: unknown) => calls.push([kind, recipient]),
    });
    let sendResult = true;
    const mail = {
      activate: () => calls.push("activate"),
      outgoingMessages: { push: () => calls.push("created") },
      OutgoingMessage: (properties: unknown) => {
        calls.push(["message", properties]);
        return {
          toRecipients: recipients("to"),
          ccRecipients: recipients("cc"),
          bccRecipients: recipients("bcc"),
          send: () => sendResult,
        };
      },
      ToRecipient: (properties: unknown) => properties,
      CcRecipient: (properties: unknown) => properties,
      BccRecipient: (properties: unknown) => properties,
    };
    const email = { to: ["a@x.test"], cc: ["c@x.test"], bcc: [], subject: "Plan", body: "Hi" };
    expect(runJxa(MAC_TOOL_SCRIPTS.mac_mail_send, email, mail).result).toEqual({
      sent: true,
      to: ["a@x.test"],
      subject: "Plan",
    });
    expect(calls).toEqual([
      "activate",
      ["message", { subject: "Plan", content: "Hi", visible: true }],
      "created",
      ["to", { address: "a@x.test" }],
      ["cc", { address: "c@x.test" }],
    ]);
    sendResult = false;
    expect(() => runJxa(MAC_TOOL_SCRIPTS.mac_mail_send, email, mail)).toThrow("ROBOTS:not-sent");
  });

  it("sends a message to a person through the signed-in account, or to an existing chat", () => {
    const sent: unknown[] = [];
    const messages = {
      accounts: {
        whose: (query: { serviceType?: string }) => () =>
          query.serviceType === "iMessage"
            ? [{ participants: { byName: (name: string) => ({ person: name }) } }]
            : [],
      },
      chats: { byId: (id: string) => ({ chat: id, id: () => id }) },
      send: (text: string, options: unknown) => sent.push([text, options]),
    };
    runJxa(MAC_TOOL_SCRIPTS.mac_messages_send, { to: "+15550100", text: "On my way" }, messages);
    runJxa(
      MAC_TOOL_SCRIPTS.mac_messages_send,
      { chat_guid: "iMessage;+;chat1", text: "Hi all" },
      messages,
    );
    expect(sent).toEqual([
      ["On my way", { to: { person: "+15550100" } }],
      ["Hi all", { to: expect.objectContaining({ chat: "iMessage;+;chat1" }) }],
    ]);
    const noAccount = { ...messages, accounts: { whose: () => () => [] } };
    expect(() =>
      runJxa(MAC_TOOL_SCRIPTS.mac_messages_send, { to: "+15550100", text: "x" }, noAccount),
    ).toThrow("ROBOTS:no-account");
  });

  it("lists events overlapping the range across calendars in start order", () => {
    const queries: unknown[] = [];
    const calendar = (name: string, starts: string[]) => ({
      name: () => name,
      events: {
        whose: (query: unknown) => {
          queries.push(query);
          return {
            uid: () => starts.map((_, index) => `${name}-${index}`),
            summary: () => starts.map((_, index) => `${name} ${index}`),
            startDate: () => starts.map((start) => new Date(start)),
            endDate: () => starts.map((start) => new Date(Date.parse(start) + 3_600_000)),
            location: () => starts.map(() => ""),
            alldayEvent: () => starts.map(() => false),
          };
        },
      },
    });
    const app = {
      calendars: Object.assign(
        () => [
          calendar("Work", ["2026-11-21T15:00:00Z"]),
          calendar("Home", ["2026-11-21T09:00:00Z"]),
        ],
        { whose: () => () => [] },
      ),
    };
    const { result } = runJxa(
      MAC_TOOL_SCRIPTS.mac_calendar_events,
      { from: "2026-11-21T00:00:00Z", to: "2026-11-22T00:00:00Z", limit: 10 },
      app,
    );
    expect(result.events.map((event: { id: string }) => event.id)).toEqual(["Home-0", "Work-0"]);
    expect(queries[0]).toEqual({
      _and: [
        { startDate: { _lessThan: new Date("2026-11-22T00:00:00Z") } },
        { endDate: { _greaterThan: new Date("2026-11-21T00:00:00Z") } },
      ],
    });
    expect(() =>
      runJxa(
        MAC_TOOL_SCRIPTS.mac_calendar_events,
        { from: "2026-11-21T00:00:00Z", to: "2026-11-22T00:00:00Z", calendar: "Nope", limit: 10 },
        app,
      ),
    ).toThrow("ROBOTS:not-found");
  });
});
