import type { ActionRule } from "@robots/contracts";
import type { ActionApprovalRule } from "@robots/core";
import type * as Db from "@robots/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { gateToolCall } from "./run-tool-gate.js";
import type { ToolRequest } from "./run-tool-request.js";
import { MAC_APP_OFFLINE_MESSAGE, macAppGate, macAppTool } from "./run-tools-mac-apps.js";
import { UserDeviceEmulator } from "./user-device-emulator.js";
import type { UserDeviceGateway } from "./user-device-protocol.js";

const order = vi.hoisted(() => [] as string[]);

vi.mock("@robots/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  recordAuditEvent: vi.fn(async () => {}),
  tryRecordAuditEvent: vi.fn(async (event: { metadata?: { decision?: string } }) => {
    order.push(`audit:${event.metadata?.decision}`);
    return true;
  }),
}));
vi.mock("./run-effects.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordEffect: vi.fn(async () => {
    order.push("effect");
    return { duplicate: false, effect: { id: "effect-1", status: "intended" } };
  }),
  claimEffect: vi.fn(async () => {
    order.push("claim");
    return true;
  }),
}));
vi.mock("./run-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renewRunLease: vi.fn(async () => {
    order.push("card");
    return false;
  }),
}));

function gateCtx(options: { approvedEffect?: boolean; paired?: boolean } = {}) {
  const findFirst = vi.fn(async (_query: unknown) =>
    options.approvedEffect ? { id: "e1" } : null,
  );
  const ctx = {
    deps: {
      userDevices: {
        pairedSince: async () => (options.paired === false ? null : new Date(1_000)),
      },
      prisma: { externalEffect: { findFirst } },
    },
    run: { spaceId: "space-1", userId: "user-1" },
  } as unknown as RunContext;
  return { ctx, findFirst };
}

const none = { blocked: false, actionRule: undefined, listSource: "default" as const };

describe("macAppGate", () => {
  it("asks once per app, then allows that app's reading and changing tools in this space", async () => {
    const first = gateCtx();
    await expect(macAppGate(first.ctx, "mac_mail_search", none)).resolves.toEqual({
      plan: "ask",
      everyTime: false,
    });
    expect(first.findFirst).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        status: { in: ["approved", "executing", "completed", "uncertain"] },
        createdAt: { gte: new Date(1_000) },
        run: { userId: "user-1" },
        kind: { in: ["mac_mail_search", "mac_mail_read", "mac_mail_draft"] },
      },
      select: { id: true },
    });
    const later = gateCtx({ approvedEffect: true });
    await expect(macAppGate(later.ctx, "mac_mail_draft", none)).resolves.toEqual({
      plan: "allow",
      everyTime: false,
    });
  });

  it("asks again when this Mac is no longer paired", async () => {
    const { ctx, findFirst } = gateCtx({ paired: false, approvedEffect: true });
    await expect(macAppGate(ctx, "mac_notes_read", none)).resolves.toEqual({
      plan: "ask",
      everyTime: false,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["an approved app", none, true],
    ["an Allowed rule", { ...none, actionRule: "allow" as const }, false],
    ["an always-allow approval rule", { ...none, listSource: "always_allow" as const }, false],
  ])(
    "asks for every email and message to send, even with %s",
    async (_label, verdict, approved) => {
      for (const tool of ["mac_mail_send", "mac_messages_send"]) {
        const { ctx, findFirst } = gateCtx({ approvedEffect: approved });
        await expect(macAppGate(ctx, tool, verdict)).resolves.toEqual({
          plan: "ask",
          everyTime: true,
        });
        expect(findFirst).not.toHaveBeenCalled();
      }
    },
  );

  it("turns a tool off with a deny rule or a block", async () => {
    const { ctx } = gateCtx({ approvedEffect: true });
    for (const verdict of [
      { ...none, actionRule: "deny" as const },
      { ...none, blocked: true },
    ])
      await expect(macAppGate(ctx, "mac_mail_send", verdict)).resolves.toMatchObject({
        plan: "deny",
      });
  });

  it("asks every time under an Ask each time rule even for an approved app", async () => {
    const { ctx } = gateCtx({ approvedEffect: true });
    for (const verdict of [
      { ...none, actionRule: "ask" as const },
      { ...none, listSource: "require_approval" as const },
    ])
      await expect(macAppGate(ctx, "mac_contacts_search", verdict)).resolves.toEqual({
        plan: "ask",
        everyTime: true,
      });
  });

  it("asks every time for new events and location unless Allowed", async () => {
    for (const tool of ["mac_calendar_create_event", "mac_location_current"]) {
      const { ctx } = gateCtx({ approvedEffect: true });
      await expect(macAppGate(ctx, tool, none)).resolves.toEqual({ plan: "ask", everyTime: true });
      await expect(macAppGate(ctx, tool, { ...none, actionRule: "allow" })).resolves.toEqual({
        plan: "allow",
        everyTime: false,
      });
    }
  });
});

function gateRequest(name: string, args: Record<string, unknown>) {
  const executionId = JSON.stringify(["pi-tool", "main", "call-1"]);
  const request: ToolRequest = {
    name,
    args,
    executionId,
    connectorCall: { tool: name, args, executionId, route: undefined },
    effectRequest: args,
    resolvedTool: undefined,
    catalogRemapped: false,
    nextApprovedTool: undefined,
    approvedEffectKey: undefined,
    replayEffectToolName: name,
    fleetSummary: undefined,
    heldForApproval: false,
    purchase: undefined,
    cardUse: undefined,
    loginUse: undefined,
  };
  return request;
}

function gate(
  name: string,
  args: Record<string, unknown>,
  options: {
    actionRules?: ActionRule[];
    approvalRules?: ActionApprovalRule[];
    mode?: "never" | "ask";
    approvedApp?: boolean;
  } = {},
) {
  const ctx = {
    deps: {
      userDevices: { pairedSince: async () => new Date(0) },
      prisma: {
        externalEffect: {
          findMany: async () => [],
          findFirst: async () => (options.approvedApp ? { id: "e0" } : null),
        },
        attempt: { count: async () => 1 },
      },
    },
    run: { id: "run-1", userId: "user-1", spaceId: "space-1", trigger: "user" },
    runId: "run-1",
    bot: { id: "bot-1", name: "Helper" },
    thread: { id: "thread-1" },
    context: { signal: new AbortController().signal },
    source: { ownerStartedRun: true, userComputerOwner: "user-1" },
    tools: { connector: new Map(), connectedPlugins: [] },
    secrets: [],
    state: {
      tainted: false,
      effects: { consumedIds: new Set(), counts: new Map(), occurrences: [] },
      approval: {},
    },
    trust: {
      initiator: "you",
      loadActionRules: async () => options.actionRules ?? [],
      loadApprovalRules: async () => options.approvalRules ?? [],
      loadAutoReviewPreference: async () => ({
        enabled: false,
        skipApprovals: options.mode === "never",
      }),
      receivedOutsideMessage: async () => false,
      loadTrustedSites: async () => new Set(),
      loadTrustedConnectors: async () => new Set(),
      routineNamesNewSite: async () => false,
    },
  };
  return gateToolCall(ctx as never, gateRequest(name, args), undefined);
}

const actionRule = (
  effect: ActionRule["effect"],
  matchValue: string,
  matchKind: ActionRule["matchKind"] = "tool",
): ActionRule =>
  ({ id: `rule-${effect}`, matchKind, matchValue, effect, initiator: null }) as ActionRule;

const email = { to: ["a@example.test"], cc: [], bcc: [], subject: "Hi", body: "Body" };

describe("gateToolCall for Mac app tools", () => {
  beforeEach(() => {
    order.length = 0;
  });

  it("puts every email up for approval, in Never ask mode and under an allow-all rule", async () => {
    const outcome = await gate("mac_mail_send", email, {
      mode: "never",
      actionRules: [actionRule("allow", "mac_*")],
      approvalRules: [{ effect: "always_allow", matchKind: "tool", matchValue: "mac_mail_send" }],
      approvedApp: true,
    });
    expect(order).toEqual(["effect", "audit:asked", "card"]);
    expect(outcome).not.toHaveProperty("call");
  });

  it("runs a read in an app approved earlier without a card", async () => {
    const outcome = await gate(
      "mac_mail_search",
      { mailbox: "inbox", unread_only: false, limit: 20 },
      { approvedApp: true },
    );
    expect(order).toEqual(["effect", "audit:allowed", "claim"]);
    expect(outcome).toHaveProperty("call");
  });

  it("asks before the first read of an app, even in Never ask mode", async () => {
    await gate("mac_notes_search", { query: "trip", limit: 20 }, { mode: "never" });
    expect(order).toEqual(["effect", "audit:asked", "card"]);
  });

  it("turns off a whole app with a connector rule and its email with the email category", async () => {
    const offApp = await gate(
      "mac_mail_search",
      { limit: 20 },
      {
        actionRules: [actionRule("deny", "mac_mail", "connector")],
        approvedApp: true,
      },
    );
    expect(offApp).toEqual({
      result: { error: expect.stringContaining("is not allowed: your action rule") },
    });
    order.length = 0;
    const offEmail = await gate("mac_mail_send", email, {
      actionRules: [actionRule("deny", "email", "category")],
    });
    expect(offEmail).toEqual({
      result: { error: expect.stringContaining("is not allowed: your action rule") },
    });
    order.length = 0;
    const readStillOn = await gate(
      "mac_mail_search",
      { limit: 20 },
      {
        actionRules: [actionRule("deny", "email", "category")],
        approvedApp: true,
      },
    );
    expect(readStillOn).toHaveProperty("call");
  });

  it("asks every time for a tool set to Ask each time", async () => {
    await gate(
      "mac_contacts_search",
      { query: "Ana", limit: 20 },
      {
        actionRules: [actionRule("ask", "mac_contacts_search")],
        approvedApp: true,
      },
    );
    expect(order).toEqual(["effect", "audit:asked", "card"]);
  });
});

describe("Mac app approval cards", () => {
  it("shows exactly the email that will be sent, once", () => {
    expect(
      buildApprovalAskBlock(
        "effect-1",
        "mac_mail_send",
        { ...email, cc: ["c@example.test"], body: "Token sk-fake\nSee you" },
        ["sk-fake"],
        { onceOnly: true },
      ),
    ).toEqual({
      kind: "ask",
      approvalEffectId: "effect-1",
      text: "Send this email from Mail on your Mac?",
      detail: "To: a@example.test\nCc: c@example.test\nSubject: Hi\n\nToken [redacted]\nSee you",
      detailFormat: "text",
      status: "pending",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    });
  });

  it("shows the recipient and text of a message", () => {
    expect(
      buildApprovalAskBlock(
        "effect-1",
        "mac_messages_send",
        { to: "+15550100", text: "On my way" },
        [],
        {
          onceOnly: true,
        },
      ),
    ).toMatchObject({
      text: "Send this message from Messages on your Mac?",
      detail: "To: +15550100\n\nOn my way",
    });
  });

  it("escapes an event title in the card heading", () => {
    expect(
      buildApprovalAskBlock(
        "effect-1",
        "mac_calendar_create_event",
        {
          title: "Lunch *with* [team]",
          start: "2026-11-21T12:00:00Z",
          end: "2026-11-21T13:00:00Z",
          all_day: false,
        },
        [],
        { onceOnly: true },
      ),
    ).toMatchObject({
      text: "Add “Lunch \\*with\\* \\[team\\]” to Calendar on your Mac?",
      detail: "Starts: 2026-11-21T12:00:00Z\nEnds: 2026-11-21T13:00:00Z",
    });
  });

  it("asks to use an app in this space the first time", () => {
    expect(
      buildApprovalAskBlock("effect-1", "mac_notes_search", { query: "trip", limit: 20 }, []),
    ).toMatchObject({
      text: "Use Notes on your Mac?",
      detail: "Search your notes\nSearch: trip",
      actions: [
        { id: "allow", label: "Allow in this space" },
        { id: "deny", label: "Deny" },
      ],
    });
  });
});

describe("macAppTool", () => {
  function handlerCtx(userDevices: UserDeviceGateway) {
    return {
      deps: { userDevices },
      bot: { id: "bot-1" },
      runId: "run-1",
      source: { userComputerOwner: "user-1" },
      context: { signal: new AbortController().signal },
      secrets: ["sk-fake"],
    } as unknown as RunContext;
  }
  const call = (name: string, args: Record<string, unknown>) =>
    ({ name, args, finish: async (result: unknown) => result }) as unknown as ToolCall;

  it("sends the validated call to the owner's Mac and returns its answer redacted", async () => {
    const emulator = new UserDeviceEmulator();
    const result = await macAppTool(
      handlerCtx(emulator),
      call("mac_notes_search", { query: "sk-fake" }),
    );
    expect(emulator.requests).toEqual([
      {
        userId: "user-1",
        request: {
          method: "macApp",
          botId: "bot-1",
          runId: "run-1",
          call: { tool: "mac_notes_search", args: { query: "sk-fake", limit: 20 } },
        },
      },
    ]);
    expect(result).toEqual({
      kind: "agent_tool_result",
      content: [{ type: "text", text: '{"emulated":true,"tool":"mac_notes_search"}' }],
      details: { app: "Notes", done: "Search your notes" },
    });
  });

  it("fails cleanly when the Mac is offline or the computer is not a Mac", async () => {
    const offline: UserDeviceGateway = {
      connected: async () => null,
      pairedSince: async () => new Date(0),
      request: () => {
        throw new Error("unreachable");
      },
    };
    await expect(
      macAppTool(handlerCtx(offline), call("mac_location_current", {})),
    ).resolves.toEqual({ error: MAC_APP_OFFLINE_MESSAGE });
    const windows: UserDeviceGateway = {
      ...offline,
      connected: async () => ({ deviceId: "pc", name: "PC", platform: "win32" }),
    };
    await expect(
      macAppTool(handlerCtx(windows), call("mac_location_current", {})),
    ).resolves.toEqual({ error: MAC_APP_OFFLINE_MESSAGE });
  });

  it("reports what the Mac said when it could not finish", async () => {
    const failing: UserDeviceGateway = {
      connected: async () => ({ deviceId: "mac", name: "Mac", platform: "darwin" }),
      pairedSince: async () => new Date(0),
      // biome-ignore lint/correctness/useYield: the device fails before answering
      async *request<T>(_userId: string, _request: HostComputerRequest): AsyncIterable<T> {
        throw new Error("Notes did not open for sk-fake.");
      },
    };
    await expect(
      macAppTool(handlerCtx(failing), call("mac_notes_read", { id: "x-coredata://A/ICNote/p1" })),
    ).resolves.toEqual({
      error: "The user's Mac did not finish: Notes did not open for [redacted].",
    });
  });
});
