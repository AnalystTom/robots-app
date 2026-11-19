import type { ActionRule } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { actionInitiator, evaluateActionRules, toolPatternMatches } from "./action-rules.js";

const rule = (
  id: string,
  matchKind: ActionRule["matchKind"],
  matchValue: string,
  effect: ActionRule["effect"],
  initiator: ActionRule["initiator"] = null,
) => ({ id, matchKind, matchValue, effect, initiator }) as ActionRule;

const sendEmail = { name: "send_email" };
const gmailSend = { name: "GMAIL_SEND_EMAIL", connectorKind: "gmail" };

describe("evaluateActionRules", () => {
  it("leaves the mode in charge when nothing matches", () => {
    expect(
      evaluateActionRules({
        rules: [rule("a", "tool", "web_search", "deny")],
        actions: [sendEmail],
        initiator: "you",
      }),
    ).toBeUndefined();
  });

  it("lets the first matching rule decide between allow and ask", () => {
    const verdict = evaluateActionRules({
      rules: [rule("a", "tool", "send_*", "allow"), rule("b", "tool", "send_email", "ask")],
      actions: [sendEmail],
      initiator: "you",
    });
    expect(verdict).toMatchObject({ effect: "allow", basis: "rule", index: 0 });
  });

  it("lets a later deny beat an earlier allow", () => {
    const verdict = evaluateActionRules({
      rules: [rule("a", "tool", "*", "allow"), rule("b", "connector", "gmail", "deny")],
      actions: [gmailSend],
      initiator: "you",
    });
    expect(verdict).toMatchObject({ effect: "deny", index: 1 });
  });

  it("matches an app's actions by the app and by a tool pattern", () => {
    for (const matched of [
      rule("a", "connector", "gmail", "ask"),
      rule("b", "tool", "gmail_*", "ask"),
      rule("c", "category", "email", "ask"),
    ]) {
      expect(
        evaluateActionRules({ rules: [matched], actions: [gmailSend], initiator: "you" }),
      ).toMatchObject({ effect: "ask" });
    }
  });

  it("applies a rule only to the initiator it names", () => {
    const rules = [rule("a", "tool", "send_email", "deny", "webhook")];
    expect(evaluateActionRules({ rules, actions: [sendEmail], initiator: "you" })).toBeUndefined();
    expect(
      evaluateActionRules({ rules, actions: [sendEmail], initiator: "webhook" }),
    ).toMatchObject({ effect: "deny" });
  });

  it("never allows when a rule is malformed", () => {
    const verdict = evaluateActionRules({
      rules: [
        { id: "x", matchKind: "tool", matchValue: "", effect: "allow" },
        rule("a", "tool", "*", "allow"),
      ],
      actions: [sendEmail],
      initiator: "you",
    });
    expect(verdict).toEqual({ effect: "ask", basis: "invalid_rule", index: 0 });
  });

  it("still denies when a malformed rule sits beside a matching deny", () => {
    const verdict = evaluateActionRules({
      rules: [null, rule("a", "tool", "send_email", "deny")],
      actions: [sendEmail],
      initiator: "you",
    });
    expect(verdict).toMatchObject({ effect: "deny", index: 1 });
  });

  it("allows a batch by rule only when every action is allowed", () => {
    const rules = [rule("a", "tool", "send_email", "allow")];
    expect(
      evaluateActionRules({
        rules,
        actions: [sendEmail, { name: "delete_email" }],
        initiator: "you",
      }),
    ).toBeUndefined();
    expect(
      evaluateActionRules({
        rules: [...rules, rule("b", "tool", "delete_email", "ask")],
        actions: [sendEmail, { name: "delete_email" }],
        initiator: "you",
      }),
    ).toMatchObject({ effect: "ask", index: 1 });
  });

  it("lets a deny on the batch tool itself stop the batch", () => {
    const verdict = evaluateActionRules({
      rules: [rule("a", "tool", "multi_execute", "deny"), rule("b", "tool", "*", "allow")],
      actions: [sendEmail],
      wrapper: { name: "multi_execute" },
      initiator: "you",
    });
    expect(verdict).toMatchObject({ effect: "deny", index: 0 });
  });
});

describe("toolPatternMatches", () => {
  it("treats only * as a wildcard and ignores case", () => {
    expect(toolPatternMatches("GMAIL_*", "gmail_send_email")).toBe(true);
    expect(toolPatternMatches("gmail.*", "gmail.send")).toBe(true);
    expect(toolPatternMatches("gmail.*", "gmailXsend")).toBe(false);
    expect(toolPatternMatches("send_email", "send_email_later")).toBe(false);
  });
});

describe("actionInitiator", () => {
  it("names who started the run", () => {
    expect(actionInitiator("user", true)).toBe("you");
    expect(actionInitiator("routine", false)).toBe("routine");
    expect(actionInitiator("webhook", false)).toBe("webhook");
    expect(actionInitiator("messaging", false)).toBe("chat_app");
    expect(actionInitiator("bot_message", false)).toBe("bot");
    expect(actionInitiator("follow_up", false)).toBe("bot");
    expect(actionInitiator("tickets", false)).toBe("other");
  });
});
