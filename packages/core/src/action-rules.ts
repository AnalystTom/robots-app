import type { ActionInitiator, ActionRule, ActionRuleEffect } from "@robots/contracts";
import { ActionRuleSchema } from "@robots/contracts";
import {
  categoryMatches,
  connectorKindFromToolName,
  routesAroundBlocks,
} from "./action-approval.js";

export type ActionRuleSubject = {
  name: string;
  aliases?: readonly string[];
  connectorKind?: string;
  readOnly?: boolean;
};

export type ActionRuleVerdict =
  | { effect: ActionRuleEffect; basis: "rule"; rule: ActionRule; index: number }
  | { effect: "ask"; basis: "invalid_rule"; index: number };

type IndexedRule = { rule: ActionRule; index: number };

export function actionInitiator(trigger: string, ownerStartedRun: boolean): ActionInitiator {
  if (ownerStartedRun) return "you";
  switch (trigger) {
    case "routine":
      return "routine";
    case "webhook":
      return "webhook";
    case "messaging":
      return "chat_app";
    case "bot_message":
    case "spawn":
    case "follow_up":
      return "bot";
    default:
      return "other";
  }
}

export function toolPatternMatches(pattern: string, toolName: string): boolean {
  const source = pattern
    .toLowerCase()
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(toolName.toLowerCase());
}

function ruleMatchesAction(rule: ActionRule, action: ActionRuleSubject): boolean {
  if (rule.effect === "deny" && routesAroundBlocks(action.name)) return true;
  const connectorKind = action.connectorKind ?? connectorKindFromToolName(action.name);
  switch (rule.matchKind) {
    case "tool":
      return [action.name, ...(action.aliases ?? [])].some((name) =>
        toolPatternMatches(rule.matchValue, name),
      );
    case "connector":
      return connectorKind.toLowerCase() === rule.matchValue.toLowerCase();
    case "category":
      return categoryMatches(rule.matchValue, action.name, connectorKind, action.readOnly);
  }
}

function matchesInitiator(rule: ActionRule, initiator: ActionInitiator): boolean {
  return rule.initiator === null || rule.initiator === initiator;
}

function verdictOf(match: IndexedRule): ActionRuleVerdict {
  return { effect: match.rule.effect, basis: "rule", rule: match.rule, index: match.index };
}

export function evaluateActionRules(input: {
  rules: readonly unknown[];
  actions: readonly ActionRuleSubject[];
  wrapper?: ActionRuleSubject;
  initiator: ActionInitiator;
}): ActionRuleVerdict | undefined {
  const valid: IndexedRule[] = [];
  let firstInvalid: number | undefined;
  input.rules.forEach((candidate, index) => {
    const parsed = ActionRuleSchema.safeParse(candidate);
    if (parsed.success) valid.push({ rule: parsed.data, index });
    else firstInvalid ??= index;
  });
  const applicable = valid.filter(({ rule }) => matchesInitiator(rule, input.initiator));
  const matchesFor = (action: ActionRuleSubject) =>
    applicable.filter(({ rule }) => ruleMatchesAction(rule, action));

  const perAction = input.actions.map(matchesFor);
  const wrapperDenies = input.wrapper
    ? matchesFor(input.wrapper).filter(({ rule }) => rule.effect === "deny")
    : [];
  const deny = [...perAction.flat(), ...wrapperDenies]
    .filter(({ rule }) => rule.effect === "deny")
    .sort((left, right) => left.index - right.index)[0];
  if (deny) return verdictOf(deny);
  if (firstInvalid !== undefined)
    return { effect: "ask", basis: "invalid_rule", index: firstInvalid };

  const firsts = perAction.map((matches) => matches[0]);
  const ask = firsts.find((match) => match?.rule.effect === "ask");
  if (ask) return verdictOf(ask);
  const [first] = firsts;
  if (first && firsts.every((match) => match?.rule.effect === "allow")) return verdictOf(first);
  return undefined;
}
