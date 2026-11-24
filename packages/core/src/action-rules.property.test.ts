import type { ActionInitiator, ActionRule } from "@robots/contracts";
import { ACTION_RULE_EFFECTS, ACTION_RULE_INITIATORS } from "@robots/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateActionRules } from "./action-rules.js";

const SEED = 42;
const TOOLS = ["send_email", "gmail_send_email", "web_search", "shell", "stripe_create_charge"];

const ruleArb: fc.Arbitrary<ActionRule> = fc.oneof(
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("tool" as const),
    matchValue: fc.constantFrom(...TOOLS, "*", "gmail_*", "send_*", "*_email"),
    effect: fc.constantFrom(...ACTION_RULE_EFFECTS),
    initiator: fc.option(fc.constantFrom(...ACTION_RULE_INITIATORS), { nil: null }),
  }),
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("connector" as const),
    matchValue: fc.constantFrom("gmail", "stripe", "shell", "web"),
    effect: fc.constantFrom(...ACTION_RULE_EFFECTS),
    initiator: fc.option(fc.constantFrom(...ACTION_RULE_INITIATORS), { nil: null }),
  }),
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("category" as const),
    matchValue: fc.constantFrom("email" as const, "purchase" as const),
    effect: fc.constantFrom(...ACTION_RULE_EFFECTS),
    initiator: fc.option(fc.constantFrom(...ACTION_RULE_INITIATORS), { nil: null }),
  }),
);
const malformedArb = fc.oneof(
  fc.constant(null),
  fc.string(),
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("tool"),
    matchValue: fc.constant(""),
    effect: fc.constant("allow"),
    initiator: fc.constant(null),
  }),
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("site"),
    matchValue: fc.constant("x.com"),
    effect: fc.constant("allow"),
    initiator: fc.constant(null),
  }),
  fc.record({
    id: fc.uuid(),
    matchKind: fc.constant("tool"),
    matchValue: fc.constant("*"),
    effect: fc.constant("always_allow"),
    initiator: fc.constant(null),
  }),
);
const initiatorArb = fc.constantFrom<ActionInitiator>(...ACTION_RULE_INITIATORS, "other");
const actionsArb = fc.array(fc.record({ name: fc.constantFrom(...TOOLS) }), {
  minLength: 1,
  maxLength: 3,
});

describe("evaluateActionRules properties", () => {
  it("denies whenever any applicable rule denies a matching action, wherever it sits", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }),
        actionsArb,
        initiatorArb,
        (rules, actions, initiator) => {
          const denyRule: ActionRule = {
            id: "deny-all",
            matchKind: "tool",
            matchValue: "*",
            effect: "deny",
            initiator: null,
          };
          for (let at = 0; at <= rules.length; at++) {
            const withDeny = [...rules.slice(0, at), denyRule, ...rules.slice(at)];
            expect(evaluateActionRules({ rules: withDeny, actions, initiator })?.effect).toBe(
              "deny",
            );
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("never allows once any rule is malformed", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }),
        malformedArb,
        fc.nat(8),
        actionsArb,
        initiatorArb,
        (rules, malformed, at, actions, initiator) => {
          const mixed: unknown[] = [...rules];
          mixed.splice(Math.min(at, mixed.length), 0, malformed);
          const verdict = evaluateActionRules({ rules: mixed, actions, initiator });
          expect(verdict).toBeDefined();
          expect(verdict?.effect).not.toBe("allow");
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("adding a deny rule never loosens the verdict", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }),
        ruleArb,
        actionsArb,
        initiatorArb,
        (rules, extra, actions, initiator) => {
          const before = evaluateActionRules({ rules, actions, initiator });
          const after = evaluateActionRules({
            rules: [...rules, { ...extra, effect: "deny" }],
            actions,
            initiator,
          });
          if (before?.effect === "deny") expect(after?.effect).toBe("deny");
          if (after?.effect !== "deny") expect(after).toEqual(before);
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("ignores rules for other initiators", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }),
        actionsArb,
        initiatorArb,
        (rules, actions, initiator) => {
          const relevant = rules.filter(
            (rule) => rule.initiator === null || rule.initiator === initiator,
          );
          const strip = (verdict: ReturnType<typeof evaluateActionRules>) =>
            verdict && verdict.basis === "rule"
              ? { effect: verdict.effect, id: verdict.rule.id }
              : verdict;
          expect(strip(evaluateActionRules({ rules, actions, initiator }))).toEqual(
            strip(evaluateActionRules({ rules: relevant, actions, initiator })),
          );
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("decides by a rule that names the decision and matches", () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }),
        actionsArb,
        initiatorArb,
        (rules, actions, initiator) => {
          const verdict = evaluateActionRules({ rules, actions, initiator });
          if (!verdict) return;
          expect(verdict.basis).toBe("rule");
          if (verdict.basis !== "rule") return;
          expect(rules[verdict.index]).toEqual(verdict.rule);
          expect(verdict.rule.effect).toBe(verdict.effect);
          expect(verdict.rule.initiator === null || verdict.rule.initiator === initiator).toBe(
            true,
          );
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });
});
