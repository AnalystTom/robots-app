import type { ActionRule } from "@robots/contracts";
import type * as Db from "@robots/db";
import { tryRecordAuditEvent } from "@robots/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordEffect } from "./run-effects.js";
import { gateToolCall } from "./run-tool-gate.js";
import type { ToolRequest } from "./run-tool-request.js";

const order = vi.hoisted(() => [] as string[]);
const auditAccepts = vi.hoisted(() => ({ value: true }));

vi.mock("@robots/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  recordAuditEvent: vi.fn(async () => {}),
  tryRecordAuditEvent: vi.fn(async (event: { metadata?: { decision?: string } }) => {
    order.push(`audit:${event.metadata?.decision}`);
    return auditAccepts.value;
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

const rule = (
  effect: ActionRule["effect"],
  initiator: ActionRule["initiator"] = null,
  matchValue = "send_*",
): ActionRule => ({ id: `rule-${effect}`, matchKind: "tool", matchValue, effect, initiator });

function gate(options: {
  rules?: unknown[];
  mode?: "ask" | "never";
  trigger?: string;
  initiator?: string;
}) {
  const args = { to: "someone@example.test", subject: "Hello", body: "secret-body-text" };
  const executionId = JSON.stringify(["pi-tool", "main", "call-1"]);
  const request: ToolRequest = {
    name: "send_email",
    args,
    executionId,
    connectorCall: { tool: "send_email", args, executionId, route: undefined },
    effectRequest: args,
    resolvedTool: undefined,
    catalogRemapped: false,
    nextApprovedTool: undefined,
    approvedEffectKey: undefined,
    replayEffectToolName: "send_email",
    fleetSummary: undefined,
    heldForApproval: false,
    purchase: undefined,
    cardUse: undefined,
    loginUse: undefined,
  };
  const ctx = {
    deps: {
      prisma: {
        externalEffect: { findMany: async () => [] },
        attempt: { count: async () => 1 },
      },
    },
    run: { id: "run-1", userId: "user-1", spaceId: "space-1", trigger: options.trigger ?? "user" },
    runId: "run-1",
    bot: { id: "bot-1", name: "Helper" },
    thread: { id: "thread-1" },
    context: { signal: new AbortController().signal },
    source: { ownerStartedRun: (options.trigger ?? "user") === "user" },
    tools: { connector: new Map(), connectedPlugins: [] },
    secrets: [],
    state: {
      tainted: false,
      effects: { consumedIds: new Set(), counts: new Map(), occurrences: [] },
      approval: {},
    },
    trust: {
      initiator: options.initiator ?? "you",
      loadActionRules: async () => options.rules ?? [],
      loadApprovalRules: async () => [],
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
  return gateToolCall(ctx as never, request, undefined);
}

function lastDecision() {
  return vi.mocked(tryRecordAuditEvent).mock.calls.at(-1)?.[0];
}

describe("gateToolCall with action rules", () => {
  beforeEach(() => {
    order.length = 0;
    auditAccepts.value = true;
    vi.mocked(tryRecordAuditEvent).mockClear();
  });

  it("refuses an action a rule denies, tells the bot why, and records the decision without recording an effect", async () => {
    const outcome = await gate({ rules: [rule("allow"), rule("deny", null, "send_email")] });

    expect(outcome).toEqual({
      result: {
        error: expect.stringMatching(
          /^Send email is not allowed: your action rule #2 \("send_email"\) denies it\./,
        ),
      },
    });
    expect(order).toEqual(["audit:denied"]);
    expect(lastDecision()).toEqual(
      expect.objectContaining({
        action: "tool.decision",
        actor: { type: "bot", id: "bot-1", label: "Helper" },
        target: expect.objectContaining({ type: "tool", id: "send_email" }),
        outcome: "denied",
        metadata: {
          decision: "denied",
          basis: "rule",
          initiator: "you",
          mode: "ask",
          ruleId: "rule-deny",
          rulePosition: 2,
        },
      }),
    );
  });

  it("writes the allow decision before it claims the effect, and never puts arguments in it", async () => {
    const outcome = await gate({ rules: [rule("allow")] });

    expect(outcome).toHaveProperty("call");
    expect(order).toEqual(["effect", "audit:allowed", "claim"]);
    const event = lastDecision();
    expect(event?.metadata).toMatchObject({
      decision: "allowed",
      basis: "rule",
      ruleId: "rule-allow",
    });
    expect(JSON.stringify(event)).not.toMatch(/secret-body-text|someone@example|Hello/);
  });

  it("does not run an allowed action whose decision could not be recorded", async () => {
    auditAccepts.value = false;

    const outcome = await gate({ rules: [rule("allow")] });

    expect(outcome).toEqual({
      result: { error: expect.stringContaining("could not be written to the audit log") },
    });
    expect(order).toEqual(["effect", "audit:allowed"]);
  });

  it("asks for an action an ask rule names even in Never ask, recording the ask before the card", async () => {
    const outcome = await gate({ rules: [rule("ask")], mode: "never" });

    expect(outcome).toEqual({
      result: expect.objectContaining({ details: { approval: "paused" } }),
    });
    expect(order).toEqual(["effect", "audit:asked", "card"]);
    expect(lastDecision()?.metadata).toMatchObject({
      decision: "asked",
      basis: "rule",
      mode: "never",
    });
  });

  it("shows no card when the ask could not be recorded", async () => {
    auditAccepts.value = false;

    await gate({ rules: [rule("ask")] });

    expect(order).toEqual(["effect", "audit:asked"]);
  });

  it("applies a rule only to its initiator, leaving the mode in charge otherwise", async () => {
    const rules = [rule("deny", "webhook")];

    await gate({ rules });
    expect(order).toEqual(["effect", "audit:asked", "card"]);
    expect(lastDecision()?.metadata).toMatchObject({ decision: "asked", basis: "mode" });

    order.length = 0;
    await gate({ rules, trigger: "webhook", initiator: "webhook" });
    expect(order).toEqual(["audit:denied"]);
  });

  it("never allows when a stored rule is malformed", async () => {
    await gate({ rules: [{ id: "x", matchKind: "tool", effect: "allow" }], mode: "never" });

    expect(order).toEqual(["effect", "audit:asked", "card"]);
    expect(lastDecision()?.metadata).toMatchObject({
      decision: "asked",
      basis: "invalid_rule",
      rulePosition: 1,
    });
  });

  it("records a person's approval before the approved action is claimed to run", async () => {
    vi.mocked(recordEffect).mockResolvedValueOnce({
      duplicate: true,
      effect: { id: "effect-1", status: "approved" },
    } as never);

    const outcome = await gate({});

    expect(outcome).toHaveProperty("call");
    expect(order).toEqual(["audit:approved", "claim"]);
    expect(lastDecision()?.metadata).toMatchObject({
      decision: "approved",
      basis: "person",
      effectId: "effect-1",
    });
  });

  it("records a person's denial", async () => {
    vi.mocked(recordEffect).mockResolvedValueOnce({
      duplicate: true,
      effect: { id: "effect-1", status: "denied" },
    } as never);

    const outcome = await gate({});

    expect(outcome).toMatchObject({ replayed: true });
    expect(order).toEqual(["audit:denied"]);
    expect(lastDecision()).toMatchObject({
      outcome: "denied",
      metadata: { decision: "denied", basis: "person" },
    });
  });
});
