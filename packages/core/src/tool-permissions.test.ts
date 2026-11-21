import type { ActionRule } from "@robots/contracts";
import { ACTION_RULES_MAX } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { evaluateActionRules } from "./action-rules.js";
import type { ToolPermissionPolicy } from "./tool-permissions.js";
import {
  appTurnedOff,
  groupToolsByEffect,
  guardedCapabilities,
  mcpPermissionToolName,
  riskyCapability,
  sharedPermissionState,
  TOOL_PERMISSIONS,
  ToolPermissionLimitError,
  toolPermissionChoices,
  toolPermissionEditable,
  toolPermissionState,
  withAppTurnedOff,
  withToolPermissions,
} from "./tool-permissions.js";

const policy = (overrides: Partial<ToolPermissionPolicy> = {}): ToolPermissionPolicy => ({
  actionRules: [],
  approvalRules: [],
  mode: "ask",
  checkerAvailable: false,
  ...overrides,
});

const send = { name: "GMAIL_SEND_EMAIL", label: "Send email" };
const fetchEmails = { name: "GMAIL_LIST_MESSAGES", label: "List messages", readOnly: true };
const draft = { name: "GMAIL_CREATE_EMAIL_DRAFT", label: "Create email draft" };
const trash = { name: "GMAIL_TRASH_MESSAGE", label: "Trash message" };

describe("toolPermissionState", () => {
  it("follows the approval mode when no rule names the tool", () => {
    expect(toolPermissionState(send, policy())).toBe("ask");
    expect(toolPermissionState(fetchEmails, policy())).toBe("allow");
    expect(toolPermissionState(send, policy({ mode: "never" }))).toBe("allow");
    expect(toolPermissionState(send, policy({ mode: "auto", checkerAvailable: true }))).toBe(
      "review",
    );
    expect(toolPermissionState(send, policy({ mode: "auto" }))).toBe("ask");
  });

  it("honours legacy approval rules the gate also reads", () => {
    expect(
      toolPermissionState(
        send,
        policy({
          approvalRules: [{ effect: "always_allow", matchKind: "tool", matchValue: send.name }],
        }),
      ),
    ).toBe("allow");
    expect(
      toolPermissionState(
        fetchEmails,
        policy({
          approvalRules: [{ effect: "deny", matchKind: "connector", matchValue: "gmail" }],
        }),
      ),
    ).toBe("deny");
  });

  it("lets an ask rule ask even when the mode never asks", () => {
    const rules: ActionRule[] = [
      { id: "a", matchKind: "tool", matchValue: send.name, initiator: null, effect: "ask" },
    ];
    expect(toolPermissionState(send, policy({ mode: "never", actionRules: rules }))).toBe("ask");
  });
});

describe("withToolPermissions", () => {
  it("round-trips every permission through the action rules the gate evaluates", () => {
    for (const mode of ["never", "ask", "auto"] as const) {
      for (const tool of [send, fetchEmails, draft]) {
        for (const permission of TOOL_PERMISSIONS) {
          const start = policy({ mode, checkerAvailable: true });
          const actionRules = withToolPermissions(start, [tool], permission);
          expect(toolPermissionState(tool, { ...start, actionRules })).toBe(permission);
        }
      }
    }
  });

  it("writes one tool rule for every initiator and keeps the user's other rules after it", () => {
    const own: ActionRule = {
      id: "mine",
      matchKind: "category",
      matchValue: "purchase",
      initiator: "webhook",
      effect: "deny",
    };
    const rules = withToolPermissions(policy({ actionRules: [own] }), [send], "deny");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      matchKind: "tool",
      matchValue: send.name,
      initiator: null,
      effect: "deny",
    });
    expect(rules[1]).toEqual(own);
    const verdict = evaluateActionRules({ rules, actions: [send], initiator: "routine" });
    expect(verdict?.effect).toBe("deny");
  });

  it("replaces the tool's earlier rule instead of stacking another", () => {
    const first = withToolPermissions(policy(), [send], "deny");
    const second = withToolPermissions(policy({ actionRules: first }), [send], "allow");
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ effect: "allow", id: first[0]?.id });
  });

  it("drops the rule when the mode already gives the chosen permission", () => {
    const denied = withToolPermissions(policy(), [send], "deny");
    expect(withToolPermissions(policy({ actionRules: denied }), [send], "ask")).toEqual([]);
  });

  it("sets a whole group in one list and skips names a rule cannot hold", () => {
    const odd = { name: "mcp__files__read/file", label: "Read file", readOnly: true };
    expect(toolPermissionEditable(odd)).toBe(false);
    const rules = withToolPermissions(policy(), [fetchEmails, odd, send], "deny");
    expect(rules.map((rule) => rule.matchValue).sort()).toEqual([fetchEmails.name, send.name]);
  });

  it("refuses to grow past the rule limit", () => {
    const full = Array.from(
      { length: ACTION_RULES_MAX },
      (_, index): ActionRule => ({
        id: `r${index}`,
        matchKind: "tool",
        matchValue: `other_${index}`,
        initiator: null,
        effect: "allow",
      }),
    );
    expect(() => withToolPermissions(policy({ actionRules: full }), [send], "deny")).toThrow(
      ToolPermissionLimitError,
    );
  });
});

describe("riskyCapability", () => {
  it("names what a consequential tool risks", () => {
    expect(riskyCapability(send, "gmail")).toBe("email");
    expect(riskyCapability({ name: "SLACK_SEND_MESSAGE" }, "slack")).toBe("message");
    expect(riskyCapability(trash, "gmail")).toBe("delete");
    expect(riskyCapability({ name: "LINKEDIN_CREATE_POST" }, "linkedin")).toBe("post");
    expect(riskyCapability({ name: "STRIPE_CREATE_REFUND" }, "stripe")).toBe("pay");
    expect(riskyCapability({ name: mcpPermissionToolName("shop", "checkout_cart") }, "shop")).toBe(
      "pay",
    );
  });

  it("leaves reads and drafts alone", () => {
    expect(riskyCapability(fetchEmails, "gmail")).toBeNull();
    expect(riskyCapability(draft, "gmail")).toBeNull();
  });
});

describe("grouping and captions", () => {
  it("merges reads into one lookup group and lists actions on their own", () => {
    const groups = groupToolsByEffect([send, fetchEmails, draft, trash]);
    expect(groups.lookups.map((tool) => tool.name)).toEqual([fetchEmails.name]);
    expect(groups.actions.map((tool) => tool.label)).toEqual([
      "Create email draft",
      "Send email",
      "Trash message",
    ]);
  });

  it("reports one state for a group, or mixed", () => {
    expect(sharedPermissionState([send, trash], policy())).toBe("ask");
    const rules = withToolPermissions(policy(), [trash], "deny");
    expect(sharedPermissionState([send, trash], policy({ actionRules: rules }))).toBe("mixed");
    expect(sharedPermissionState([], policy())).toBeNull();
  });

  it("lists the risky capabilities that still ask first", () => {
    const tools = [send, trash, fetchEmails];
    expect(guardedCapabilities(tools, "gmail", policy())).toEqual(["email", "delete"]);
    expect(guardedCapabilities(tools, "gmail", policy({ mode: "never" }))).toEqual([]);
  });
});

describe("Mac app tools", () => {
  const mailSend = { name: "mac_mail_send", label: "Send an email" };
  const mailSearch = { name: "mac_mail_search", label: "Search your email" };
  const mailDraft = { name: "mac_mail_draft", label: "Write a draft" };
  const location = { name: "mac_location_current", label: "Get your current location" };

  it("shows each tool's own default whatever the mode", () => {
    for (const mode of ["never", "ask", "auto"] as const) {
      expect(toolPermissionState(mailSearch, policy({ mode }))).toBe("once");
      expect(toolPermissionState(mailSend, policy({ mode }))).toBe("ask");
      expect(toolPermissionState(location, policy({ mode }))).toBe("ask");
    }
  });

  it("never offers to send without asking", () => {
    expect(toolPermissionChoices(mailSend)).toEqual(["ask", "deny"]);
    expect(toolPermissionChoices(mailDraft)).toEqual(["allow", "ask", "deny"]);
    expect(withToolPermissions(policy(), [mailSend], "allow")).toEqual([]);
  });

  it("round-trips the settings a Mac tool offers through tool rules", () => {
    for (const tool of [mailSend, mailSearch, mailDraft]) {
      for (const permission of toolPermissionChoices(tool)) {
        const actionRules = withToolPermissions(policy(), [tool], permission);
        expect(toolPermissionState(tool, policy({ actionRules }))).toBe(permission);
      }
    }
  });

  it("turns a whole app off with one connector rule", () => {
    const actionRules = withAppTurnedOff(policy(), "mac_mail", true);
    expect(actionRules).toEqual([
      expect.objectContaining({ matchKind: "connector", matchValue: "mac_mail", effect: "deny" }),
    ]);
    const off = policy({ actionRules });
    expect(appTurnedOff(off, "mac_mail")).toBe(true);
    expect(toolPermissionState(mailSearch, off)).toBe("deny");
    expect(toolPermissionState(send, off)).toBe("ask");
    expect(withAppTurnedOff(off, "mac_mail", false)).toEqual([]);
  });

  it("groups reads, and treats sending as the risky capability", () => {
    const groups = groupToolsByEffect([mailSend, mailSearch, mailDraft]);
    expect(groups.lookups.map((tool) => tool.name)).toEqual(["mac_mail_search"]);
    expect(riskyCapability(mailSend, "mac_mail")).toBe("email");
    expect(riskyCapability({ name: "mac_messages_send" }, "mac_messages")).toBe("message");
    expect(riskyCapability(mailDraft, "mac_mail")).toBeNull();
    expect(guardedCapabilities([mailSend, mailDraft], "mac_mail", policy())).toEqual(["email"]);
  });
});
