import type { ActionApprovalRule as StoredActionApprovalRule } from "@robots/contracts";
import { BUILTIN_TOOL_NAMES, MAC_APP_TOOL_NAMES, macAppToolEntry } from "@robots/contracts";

export { isSecretAskBlock } from "./ask-kind.js";

import { evaluateActionRules } from "./action-rules.js";
import { humanizeToolName } from "./events.js";

const APPROVAL_EXEMPT_TOOLS = new Set([
  "computer_observe",
  "computer_act",
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
  "list_files",
  "read_file",
  "read_history",
  "search_history",
  "write_file",
  "shell",
  "open_path",
  "launch_app",
  "remember",
  "request_takeover",
  "request_secret",
  "generate_secret",
  "run_subagent",
  "spawn_bot",
  "schedule_create",
  "schedule_list",
  "schedule_update",
  "schedule_cancel",
  "list_fleet",
  "organize_bot",
  "request_purchase",
]);

const OUTSIDE_RUN_SAFE_BUILTIN_TOOLS = new Set([
  "ask_user",
  "attach_file",
  "browser_snapshot",
  "cloud_agent_status",
  "computer_observe",
  "list_files",
  "list_fleet",
  "list_secrets",
  "message_user",
  "purchase_status",
  "read_email",
  "read_file",
  "read_history",
  "recall_memory",
  "reflect_memory",
  "request_takeover",
  "run_subagent",
  "schedule_list",
  "scratchpad_list",
  "search_history",
  "service_search",
  "skill_read",
  "task_catalog",
  "web_fetch",
  "web_search",
]);

const APPROVAL_REQUIRED_BUILTIN_TOOLS = new Set([
  "generate_image",
  "generate_video",
  "service_call",
  "archive_bot",
  "secret_request",
  "forget_secret",
  "forget_memory",
  "delete_email",
  "cloud_agent_launch",
  "cloud_agent_reply",
  "cloud_agent_cancel",
  "user_computer_shell",
  "user_computer_observe",
  "user_computer_act",
  "create_group",
  "update_group",
  "create_child_routine",
  "feedback",
  "send_email",
  ...MAC_APP_TOOL_NAMES,
]);
const EXPLICIT_APPROVAL_BUILTIN_TOOLS = new Set([
  "claim_email_address",
  "respond_agent_connection",
  "create_space",
  "set_child_instructions",
  "set_child_bot_model",
]);

const READ_ONLY_CONNECTOR_PATTERN = /(^|[_-])(get|list|search|find|read)([_-]|$)/i;
const PLAIN_CONNECTOR_SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)?$/;
const MUTATING_CONNECTOR_PATTERN =
  /(^|[_-])(accept|add|approve|archive|assign|buy|cancel|charge|checkout|close|commit|copy|create|delete|deploy|disable|enable|execute|forward|grant|invite|link|mark|merge|modify|move|patch|pay|post|publish|purchase|put|register|reject|remove|rename|replace|reply|reset|revoke|run|schedule|send|set|share|start|stop|submit|subscribe|trigger|unassign|unlink|unsubscribe|update|upload|upsert|write)([_-]|$)/i;
const COMPOUND_CONNECTOR_ACTION_PATTERN = /[_-](and|or|then)[_-]/i;

const EMAIL_CONNECTOR_SLUGS = new Set(["gmail", "outlook", "microsoft_outlook", "mac_mail"]);
const PURCHASE_CONNECTOR_SLUGS = new Set(["stripe", "shopify", "paypal", "square"]);

export type ActionApprovalRule = Pick<
  StoredActionApprovalRule,
  "effect" | "matchKind" | "matchValue"
>;

export function connectorKindFromToolName(toolName: string, connectorKinds: string[] = []): string {
  const normalizedTool = toolName.toLowerCase();
  const matched = connectorKinds
    .map((kind) => kind.toLowerCase())
    .filter(
      (kind) =>
        normalizedTool === kind ||
        normalizedTool.startsWith(`${kind}_`) ||
        normalizedTool.startsWith(`${kind}-`),
    )
    .sort((left, right) => right.length - left.length)[0];
  if (matched) return matched;
  const hyphen = normalizedTool.indexOf("-");
  if (hyphen > 0) {
    const slug = normalizedTool.slice(0, hyphen);
    if (PLAIN_CONNECTOR_SLUG.test(slug)) return slug;
  }
  const [segment] = toolName.split("_");
  return (segment ?? toolName).toLowerCase();
}

export function connectorToolRequiresApproval(toolName: string, readOnly?: boolean): boolean {
  if (readOnly === false) return true;
  if (MUTATING_CONNECTOR_PATTERN.test(toolName)) return true;
  if (COMPOUND_CONNECTOR_ACTION_PATTERN.test(toolName)) return true;
  return !READ_ONLY_CONNECTOR_PATTERN.test(toolName);
}

export function watchToolRefusal(input: {
  toolName: string;
  toolAliases?: readonly string[];
  readOnly?: boolean;
  connectorKind?: string;
  rules: ActionApprovalRule[];
  actionRules?: readonly unknown[];
}): string | null {
  const { toolName, readOnly } = input;
  if (readOnly !== true) {
    return `${toolName} can change data, so a change trigger can't run it. Pick a read-only tool.`;
  }
  const ruled = evaluateActionRules({
    rules: input.actionRules ?? [],
    actions: [
      {
        name: toolName,
        aliases: input.toolAliases,
        connectorKind: input.connectorKind,
        readOnly,
      },
    ],
    initiator: "routine",
  })?.effect;
  if (ruled === "deny")
    return `${toolName} is not allowed by your action rules, so a change trigger can't run it.`;
  if (ruled === "ask") {
    return `${toolName} needs approval under your action rules, and a change check cannot ask.`;
  }
  const decision = resolveActionApprovalDetail({
    toolName,
    toolAliases: input.toolAliases,
    connectorKind: input.connectorKind,
    readOnly,
    rules: input.rules,
  }).decision;
  if (decision === "deny") return `${toolName} is blocked, so a change trigger can't run it.`;
  if (decision === "ask") {
    return `${toolName} needs approval under this space's rules, and a change check cannot ask.`;
  }
  return null;
}

export function toolRequiresApproval(
  toolName: string,
  viaConnector: boolean,
  readOnly?: boolean,
): boolean {
  if (APPROVAL_EXEMPT_TOOLS.has(toolName)) return false;
  if (toolRequiresExplicitApproval(toolName)) return true;
  if (APPROVAL_REQUIRED_BUILTIN_TOOLS.has(toolName)) return true;
  if (viaConnector) return connectorToolRequiresApproval(toolName, readOnly);
  return false;
}

export function outsideRunToolRequiresApproval(trigger: string, toolName: string): boolean {
  return trigger === "webhook" && !OUTSIDE_RUN_SAFE_BUILTIN_TOOLS.has(toolName);
}

export function repeatsDeniedAction(input: {
  toolName: string;
  args: unknown;
  denied: unknown[];
}): boolean {
  return input.denied.some((request) => {
    if (input.toolName !== "COMPOSIO_MULTI_EXECUTE_TOOL") return true;
    const before = innerToolSlugs(request);
    return innerToolSlugs(input.args).some((slug) => before.includes(slug));
  });
}

function innerToolSlugs(args: unknown): string[] {
  const tools = (args as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((item) => {
    const slug = (item as { tool_slug?: unknown } | null)?.tool_slug;
    return typeof slug === "string" && slug.trim() ? [slug.trim().toUpperCase()] : [];
  });
}

export function toolRequiresExplicitApproval(toolName: string): boolean {
  return EXPLICIT_APPROVAL_BUILTIN_TOOLS.has(toolName);
}

export function isOwnerStartedRun(trigger: string, followUpFromUser: boolean): boolean {
  if (trigger === "follow_up") return followUpFromUser;
  return trigger === "user" || trigger === "call_end";
}

const OWN_STATE_RESULT_TOOLS = new Set([
  "ask_user",
  "send_email",
  "connect_app",
  "attach_file",
  "claim_email_address",
  "delete_email",
  "end_call",
  "feedback",
  "generate_secret",
  "list_fleet",
  "list_secrets",
  "message_user",
  "read_history",
  "recall_memory",
  "reflect_memory",
  "remember",
  "render_plot",
  "request_secret",
  "save_memory",
  "save_page",
  "save_shared_memory",
  "schedule_cancel",
  "schedule_create",
  "schedule_list",
  "schedule_update",
  "scratchpad_add",
  "scratchpad_complete",
  "scratchpad_list",
  "scratchpad_remove",
  "scratchpad_update",
  "search_history",
  "skill_read",
  "task_catalog",
  "update_preferences",
  "write_file",
]);

export function toolResultTaintsRun(toolName: string): boolean {
  return !OWN_STATE_RESULT_TOOLS.has(toolName);
}

export function connectorReadRequiresApproval(input: {
  tainted: boolean;
  connectorTrusted: boolean;
}): boolean {
  return input.tainted && !input.connectorTrusted;
}

const MEMORY_WRITE_TOOLS = new Set(["remember", "save_memory", "save_shared_memory"]);

export async function memoryWriteNeedsApproval(
  toolName: string,
  actionTainted: () => Promise<boolean>,
): Promise<boolean> {
  return MEMORY_WRITE_TOOLS.has(toolName) && (await actionTainted());
}

export function outboundSiteGate(input: {
  site: string;
  trusted: boolean;
  rules: ActionApprovalRule[];
}): "allow" | "new" {
  return input.trusted || siteAlwaysAllowed(input.rules, input.site) ? "allow" : "new";
}

export function newSiteOutcome(input: {
  trigger: string;
  decision: "ask" | "allow";
}): "ask" | "allow" | "deny" {
  if (input.decision === "allow") return "allow";
  return input.trigger === "webhook" ? "deny" : "ask";
}

export const SITE_SENDING_TOOLS: ReadonlySet<string> = new Set(["web_fetch", "paid_request"]);

export function siteAlwaysAllowed(rules: ActionApprovalRule[], site: string): boolean {
  return rules.some(
    (rule) =>
      rule.effect === "always_allow" &&
      rule.matchKind === "site" &&
      rule.matchValue.toLowerCase() === site,
  );
}

export function categoryMatches(
  category: string,
  toolName: string,
  connectorKind: string,
  readOnly: boolean | undefined,
): boolean {
  const normalized = category.toLowerCase();
  const consequential = connectorToolRequiresApproval(toolName, readOnly);
  if (normalized === "email") {
    if (EMAIL_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /send.*mail|gmail_send|outlook_send/i.test(toolName);
  }
  if (normalized === "purchase") {
    if (PURCHASE_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /purchase|pay_|charge|checkout|buy_/i.test(toolName);
  }
  return false;
}

const COMPOSIO_CODE_TOOLS = new Set(["composio_remote_workbench", "composio_remote_bash_tool"]);

export function routesAroundBlocks(toolName: string): boolean {
  return COMPOSIO_CODE_TOOLS.has(toolName.toLowerCase());
}

function ruleMatches(
  rule: ActionApprovalRule,
  toolName: string,
  connectorKind: string,
  readOnly: boolean | undefined,
  site: string | undefined,
): boolean {
  if (rule.effect === "deny" && rule.matchKind !== "site" && routesAroundBlocks(toolName)) {
    return true;
  }
  const value = rule.matchValue.toLowerCase();
  switch (rule.matchKind) {
    case "site":
      return site === value;
    case "tool":
      return toolName.toLowerCase() === value;
    case "connector":
      return connectorKind.toLowerCase() === value;
    case "category":
      return categoryMatches(rule.matchValue, toolName, connectorKind, readOnly);
    default:
      return false;
  }
}

function ruleSpecificity(rule: ActionApprovalRule): number {
  switch (rule.matchKind) {
    case "site":
      return 4;
    case "tool":
      return 3;
    case "connector":
      return 2;
    case "category":
      return 1;
    default:
      return 0;
  }
}

export type ActionApprovalSource = "require_approval" | "always_allow" | "deny" | "default";

export type ActionApprovalResolved = {
  decision: "ask" | "allow" | "deny";
  source: ActionApprovalSource;
  matchingRules: ActionApprovalRule[];
  decisiveRules: ActionApprovalRule[];
};

export function decisiveActionApprovalRules(
  resolved: ActionApprovalResolved,
): ActionApprovalRule[] {
  if (resolved.source !== "require_approval" && resolved.source !== "deny") return [];
  return resolved.decisiveRules.filter((rule) => rule.effect === resolved.source);
}

export function resolveActionApprovalDetail(input: {
  toolName: string;
  toolAliases?: readonly string[];
  connectorKind?: string;
  readOnly?: boolean;
  site?: string;
  rules: ActionApprovalRule[];
}): ActionApprovalResolved {
  const connectorKind = input.connectorKind ?? connectorKindFromToolName(input.toolName);
  const matchingRules = input.rules.filter(
    (rule) =>
      ruleMatches(rule, input.toolName, connectorKind, input.readOnly, input.site) ||
      (rule.matchKind === "tool" &&
        input.toolAliases?.some((alias) => alias.toLowerCase() === rule.matchValue.toLowerCase())),
  );
  if (matchingRules.length === 0) {
    return { decision: "allow", source: "default", matchingRules, decisiveRules: [] };
  }
  const denyingRules = matchingRules.filter((rule) => rule.effect === "deny");
  if (denyingRules.length > 0) {
    const highestSpecificity = Math.max(...denyingRules.map(ruleSpecificity));
    return {
      decision: "deny",
      source: "deny",
      matchingRules,
      decisiveRules: denyingRules.filter((rule) => ruleSpecificity(rule) === highestSpecificity),
    };
  }

  const highestSpecificity = Math.max(...matchingRules.map(ruleSpecificity));
  const winners = matchingRules.filter((rule) => ruleSpecificity(rule) === highestSpecificity);
  const askingRules = winners.filter((rule) => rule.effect === "require_approval");
  if (askingRules.length > 0) {
    return {
      decision: "ask",
      source: "require_approval",
      matchingRules,
      decisiveRules: askingRules,
    };
  }
  return { decision: "allow", source: "always_allow", matchingRules, decisiveRules: [] };
}

export function resolveActionApproval(input: {
  toolName: string;
  connectorKind?: string;
  readOnly?: boolean;
  rules: ActionApprovalRule[];
}): "ask" | "allow" | "deny" {
  return resolveActionApprovalDetail(input).decision;
}

export function batchActions(
  shape: { items: string; action: string },
  args: unknown,
): { actions: string[]; complete: boolean } {
  const items =
    args && typeof args === "object" ? (args as Record<string, unknown>)[shape.items] : undefined;
  if (!Array.isArray(items)) return { actions: [], complete: false };
  const actions = new Set<string>();
  let complete = items.length > 0;
  for (const item of items) {
    const action =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)[shape.action]
        : undefined;
    if (typeof action === "string" && action.trim()) actions.add(action.trim());
    else complete = false;
  }
  return { actions: [...actions], complete };
}

export function resolveActionApprovalForTools(input: {
  tools: ReadonlyArray<{
    name: string;
    aliases?: readonly string[];
    connectorKind?: string;
    readOnly?: boolean;
  }>;
  wrapper?: { name: string; connectorKind?: string };
  site?: string;
  rules: ActionApprovalRule[];
}): ActionApprovalResolved {
  const resolve = (tool: {
    name: string;
    aliases?: readonly string[];
    connectorKind?: string;
    readOnly?: boolean;
  }) =>
    resolveActionApprovalDetail({
      toolName: tool.name,
      toolAliases: tool.aliases,
      connectorKind: tool.connectorKind,
      readOnly: tool.readOnly,
      site: input.site,
      rules: input.rules,
    });
  const parts = input.tools.map(resolve);
  const wrapper = input.wrapper ? resolve(input.wrapper) : undefined;
  if (wrapper?.decision === "deny") parts.push(wrapper);
  const matchingRules = [...new Set(parts.flatMap((part) => part.matchingRules))];
  const strictest =
    parts.find((part) => part.decision === "deny") ?? parts.find((part) => part.decision === "ask");
  if (strictest) return { ...strictest, matchingRules };
  const allAllowed = parts.length > 0 && parts.every((part) => part.source === "always_allow");
  return {
    decision: "allow",
    source: allAllowed ? "always_allow" : "default",
    matchingRules,
    decisiveRules: [],
  };
}

export type ApprovalMode = "never" | "auto" | "ask";

export function approvalModeFromPreference(preference: {
  enabled: boolean;
  skipApprovals: boolean;
}): ApprovalMode {
  if (preference.skipApprovals) return "never";
  return preference.enabled ? "auto" : "ask";
}

export function approvalPreferenceFromMode(mode: ApprovalMode): {
  enabled: boolean;
  skipApprovals: boolean;
} {
  return { enabled: mode === "auto", skipApprovals: mode === "never" };
}

export type AutoReviewJudgeDecision = "pass" | "ask" | "error";

export function planActionGate(input: {
  resolved: ActionApprovalResolved;
  mode: ApprovalMode;
  mandatory?: boolean;
  steerable?: boolean;
  consequential: boolean;
  reviewOnly?: boolean;
  checkerConfigured: boolean;
  newDestination?: boolean;
  purchase?: boolean;
  actionRule?: "allow" | "ask" | "deny";
}): "ask" | "allow" | "judge" | "deny" {
  if (input.resolved.decision === "deny" || input.actionRule === "deny") return "deny";
  if (input.purchase || input.actionRule === "ask") return "ask";
  if (input.mandatory) {
    if (input.mode !== "never") return "ask";
    return input.steerable ? "deny" : "allow";
  }
  if (input.mode === "never") return "allow";
  if (input.resolved.decision === "ask") return "ask";
  const review = input.mode === "auto" && input.checkerConfigured ? "judge" : "ask";
  if (input.newDestination) return review;
  if (input.resolved.source === "always_allow" || input.actionRule === "allow") return "allow";
  if (input.consequential) return review;
  return input.reviewOnly && review === "judge" ? "judge" : "allow";
}

export function applyJudgeDecision(input: {
  decision: AutoReviewJudgeDecision;
  consequential: boolean;
}): "ask" | "allow" {
  if (input.decision === "pass") return "allow";
  if (input.decision === "ask") return "ask";
  return input.consequential ? "ask" : "allow";
}

export const CARD_TITLE_ESCAPED_CHARACTERS = "[\\\\`*_[\\]<>~|]";

export function isApprovalAskBlock(block: {
  kind: string;
  approvalEffectId?: string;
  actions?: Array<{ id: string; label: string }>;
}): boolean {
  if (block.kind !== "ask" || !block.approvalEffectId || !block.actions?.length) return false;
  const actionIds = new Set(block.actions.map((action) => action.id));
  return (
    actionIds.has("allow") &&
    actionIds.has("deny") &&
    [...actionIds].every((id) => id === "allow" || id === "always" || id === "deny")
  );
}

export function receiptItems<Item extends { name: string }>(
  items: readonly Item[],
  labels: readonly string[],
): Item[] {
  const own = labels.map((label) => label.trim().toLocaleLowerCase()).filter(Boolean);
  return items.filter((item) => {
    const name = item.name.trim().toLocaleLowerCase();
    return !own.some(
      (label) => name.startsWith(label) && !/^[\p{L}\p{N}]/u.test(name.slice(label.length)),
    );
  });
}

export const APPROVAL_RULE_EFFECTS = ["always_allow", "require_approval", "deny"] as const;

export function approvalRuleApplies(
  mode: ApprovalMode | null | undefined,
  effect: ActionApprovalRule["effect"],
): boolean {
  return mode !== "never" || effect === "deny";
}

export function approvalRuleEffectChoices(
  rule: ActionApprovalRule,
): ReadonlyArray<ActionApprovalRule["effect"]> {
  if (rule.matchKind === "category") return [];
  if (
    rule.matchKind === "tool" &&
    (toolRequiresExplicitApproval(rule.matchValue) ||
      macAppToolEntry(rule.matchValue)?.tool.kind === "send")
  ) {
    return APPROVAL_RULE_EFFECTS.filter((effect) => effect !== "always_allow");
  }
  return APPROVAL_RULE_EFFECTS;
}

export function approvalRuleLabel(rule: ActionApprovalRule): string {
  return rule.matchKind === "site" ? rule.matchValue : humanizeToolName(rule.matchValue);
}

export type ApprovalRuleChoice = { matchKind: "tool"; matchValue: string; label: string };

export function approvalRuleChoices(
  rules: ReadonlyArray<ActionApprovalRule>,
): ApprovalRuleChoice[] {
  const taken = new Set(
    rules.filter((rule) => rule.matchKind === "tool").map((rule) => rule.matchValue.toLowerCase()),
  );
  return BUILTIN_TOOL_NAMES.filter((name) => !taken.has(name))
    .map(
      (name): ApprovalRuleChoice => ({
        matchKind: "tool",
        matchValue: name,
        label: humanizeToolName(name),
      }),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}
