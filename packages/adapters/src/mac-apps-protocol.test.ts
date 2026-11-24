import { MAC_APP_CONNECTIONS, MAC_APP_TOOL_NAMES } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import type { HostComputerFrame } from "./host-computer-protocol.js";
import { hostComputerRequest } from "./host-computer-protocol.js";
import { createHostComputerRunner } from "./host-computer-runner.js";
import { macAppAgentTools } from "./mac-apps.tool-definition.js";
import type { MacApps } from "./mac-apps-protocol.js";
import { MacAppError, parseMacAppCall } from "./mac-apps-protocol.js";
import { UserDeviceEmulator } from "./user-device-emulator.js";

describe("Mac app tool arguments", () => {
  it("defines one model tool per catalog tool, each with an object schema", () => {
    const catalog = MAC_APP_CONNECTIONS.flatMap((app) => app.tools.map((tool) => tool.name));
    expect([...catalog].sort()).toEqual([...MAC_APP_TOOL_NAMES].sort());
    expect(macAppAgentTools.map((tool) => tool.name)).toEqual([...MAC_APP_TOOL_NAMES]);
    for (const tool of macAppAgentTools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.inputSchema).not.toHaveProperty("$schema");
    }
    expect(macAppAgentTools.find((tool) => tool.name === "mac_mail_search")).toMatchObject({
      readOnly: true,
      label: "Mail: Search your email",
    });
    expect(macAppAgentTools.find((tool) => tool.name === "mac_mail_send")?.readOnly).toBe(false);
  });

  it("fills defaults so the device and the approval card see the same arguments", () => {
    expect(parseMacAppCall("mac_mail_search", { query: "invoice" })).toEqual({
      call: {
        tool: "mac_mail_search",
        args: { query: "invoice", mailbox: "inbox", unread_only: false, limit: 20 },
      },
    });
    expect(
      parseMacAppCall("mac_mail_send", { to: ["a@example.test"], subject: "Hi", body: "Body" }),
    ).toEqual({
      call: {
        tool: "mac_mail_send",
        args: { to: ["a@example.test"], cc: [], bcc: [], subject: "Hi", body: "Body" },
      },
    });
  });

  it("keeps quote and script characters as plain data", () => {
    const query = `" & (do shell script "rm -rf ~") & "`;
    const parsed = parseMacAppCall("mac_notes_search", { query });
    expect(parsed).toEqual({ call: { tool: "mac_notes_search", args: { query, limit: 20 } } });
  });

  it.each<[string, string, Record<string, unknown>, string]>([
    ["a control character", "mac_notes_search", { query: "a\u0000b" }, "query"],
    ["a line break in a one-line field", "mac_notes_create", { title: "a\nb" }, "title"],
    [
      "a recipient that is not an address",
      "mac_mail_send",
      { to: ["x"], subject: "s", body: "" },
      "to.0",
    ],
    [
      "a header injection in an address",
      "mac_mail_draft",
      { to: ["a@b.c\nBcc: x@y.z"], subject: "s", body: "" },
      "to.0",
    ],
    ["too many results", "mac_mail_search", { limit: 500 }, "limit"],
    ["a note id that is not one", "mac_notes_read", { id: "../../etc/passwd" }, "id"],
    [
      "a reminder id that is not one",
      "mac_reminders_complete",
      { id: "x-apple-reminder://a b" },
      "id",
    ],
    ["a contact id with quotes", "mac_contacts_read", { id: 'abc"def' }, "id"],
    [
      "a chat guid that is not one",
      "mac_messages_send",
      { chat_guid: "x", text: "hi" },
      "chat_guid",
    ],
    [
      "a time without an offset",
      "mac_calendar_events",
      { from: "2026-11-21T09:00:00", to: "2026-11-22T09:00:00Z" },
      "from",
    ],
    ["a non-integer chat id", "mac_messages_read", { chat_id: 1.5 }, "chat_id"],
  ])("refuses %s", (_label, tool, args, path) => {
    const parsed = parseMacAppCall(tool, args);
    expect(parsed).toEqual({
      error: expect.stringMatching(new RegExp(`^${path.replace(".", "\\.")}: `)),
    });
  });

  it("asks for exactly one message target", () => {
    expect(parseMacAppCall("mac_messages_send", { text: "hi" })).toEqual({
      error: "give exactly one of to or chat_guid",
    });
    expect(
      parseMacAppCall("mac_messages_send", {
        to: "+1 555 0100",
        chat_guid: "iMessage;-;+15550100",
        text: "hi",
      }),
    ).toEqual({ error: "give exactly one of to or chat_guid" });
    expect(parseMacAppCall("mac_messages_send", { to: "+1 (555) 010-0100", text: "hi" })).toEqual({
      call: { tool: "mac_messages_send", args: { to: "+1 (555) 010-0100", text: "hi" } },
    });
  });

  it("bounds calendar ranges and event times", () => {
    expect(
      parseMacAppCall("mac_calendar_events", {
        from: "2026-11-21T00:00:00Z",
        to: "2027-06-01T00:00:00Z",
      }),
    ).toEqual({ error: "to must be after from and at most 92 days later" });
    expect(
      parseMacAppCall("mac_calendar_create_event", {
        title: "Dentist",
        start: "2026-11-21T10:00:00-08:00",
        end: "2026-11-21T09:00:00-08:00",
      }),
    ).toEqual({ error: "end must not be before start" });
  });

  it("refuses a tool that is not a Mac app tool", () => {
    expect(parseMacAppCall("user_computer_shell", { command: "ls" })).toEqual({
      error: expect.any(String),
    });
  });
});

describe("Mac app requests over the device channel", () => {
  const call = { tool: "mac_notes_search", args: { query: "trip", limit: 5 } } as const;

  it("is a valid host computer request and nothing else rides along", () => {
    expect(
      hostComputerRequest.parse({ method: "macApp", botId: "bot-1", runId: "run-1", call }),
    ).toEqual({ method: "macApp", botId: "bot-1", runId: "run-1", call });
    expect(
      hostComputerRequest.safeParse({
        method: "macApp",
        botId: "bot-1",
        call: { tool: "mac_notes_search", args: { query: "a\u0007" } },
      }).success,
    ).toBe(false);
    expect(
      hostComputerRequest.safeParse({
        method: "macApp",
        botId: "bot-1",
        call: { tool: "shell", args: { command: "ls" } },
      }).success,
    ).toBe(false);
  });

  async function run(macApps: MacApps | undefined, input: unknown) {
    const runner = createHostComputerRunner({ root: "/tmp/unused", macApps });
    runner.setEnabled(true);
    const frames: HostComputerFrame<unknown>[] = [];
    const slot = runner.begin()!;
    const outcome = await slot.run(input, { open() {}, write: (frame) => void frames.push(frame) });
    slot.end();
    runner.close();
    return { outcome, frames };
  }

  it("hands the validated call to this Mac's apps and streams the answer back", async () => {
    const seen: unknown[] = [];
    const macApps: MacApps = {
      async run(received) {
        seen.push(received);
        return { notes: [{ id: "x-coredata://A/ICNote/p1", title: "Trip" }] };
      },
    };
    const { outcome, frames } = await run(macApps, { method: "macApp", botId: "bot-1", call });
    expect(outcome).toBe("finished");
    expect(seen).toEqual([call]);
    expect(frames).toEqual([
      { value: { notes: [{ id: "x-coredata://A/ICNote/p1", title: "Trip" }] } },
      { done: true },
    ]);
  });

  it("passes a Mac app's own message back and hides anything else", async () => {
    const explained = await run(
      { run: async () => Promise.reject(new MacAppError("Notes did not open.")) },
      { method: "macApp", botId: "bot-1", call },
    );
    expect(explained.frames).toEqual([{ error: "Notes did not open." }]);
    const raw = await run(
      { run: async () => Promise.reject(new Error("execution error: secret note text (-2700)")) },
      { method: "macApp", botId: "bot-1", call },
    );
    expect(raw.frames).toEqual([{ error: "Local computer operation failed" }]);
    const none = await run(undefined, { method: "macApp", botId: "bot-1", call });
    expect(none.frames).toEqual([{ error: "Mac apps are not available on this computer." }]);
  });

  it("refuses an invalid call before any app sees it", async () => {
    const seen: unknown[] = [];
    const { outcome } = await run(
      { run: async (received) => seen.push(received) },
      { method: "macApp", botId: "bot-1", call: { tool: "mac_notes_read", args: { id: "nope" } } },
    );
    expect(outcome).toBe("invalid");
    expect(seen).toEqual([]);
  });

  it("round-trips through the offline device emulator", async () => {
    const emulator = new UserDeviceEmulator();
    const values: unknown[] = [];
    for await (const value of emulator.request(
      "user-1",
      { method: "macApp", botId: "bot-1", call },
      new AbortController().signal,
    ))
      values.push(value);
    expect(values).toEqual([{ emulated: true, tool: "mac_notes_search" }]);
    expect(emulator.requests).toEqual([
      { userId: "user-1", request: { method: "macApp", botId: "bot-1", call } },
    ]);
  });
});
