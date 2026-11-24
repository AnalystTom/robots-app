import type { ActionRule, ApprovalMode, MacToolSetting } from "@robots/contracts";
import { ACTION_RULES_MAX, ActionRuleSchema, macAppToolEntry } from "@robots/contracts";
import type { ActionApprovalRule } from "./action-approval.js";
import {
  categoryMatches,
  connectorKindFromToolName,
  connectorToolRequiresApproval,
  planActionGate,
  resolveActionApprovalDetail,
  toolRequiresApproval,
  toolRequiresExplicitApproval,
} from "./action-approval.js";
import { evaluateActionRules } from "./action-rules.js";

export const TOOL_PERMISSIONS = ["allow", "ask", "deny"] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];
export type ToolPermissionState = ToolPermission | "review" | "once";

export type ToolPermissionPolicy = {
  actionRules: readonly ActionRule[];
  approvalRules: readonly ActionApprovalRule[];
  mode: ApprovalMode;
  checkerAvailable: boolean;
};

export type PermissionTool = {
  name: string;
  label: string;
  readOnly?: boolean;
};

export const RISKY_CAPABILITIES = ["email", "message", "delete", "post", "pay"] as const;
export type RiskyCapability = (typeof RISKY_CAPABILITIES)[number];

export type ConnectionPlacement = "cloud" | "this-mac";
export const SERVER_CONNECTION_PLACEMENT: ConnectionPlacement = "cloud";

const SEND_VERBS = /(^|[_-])(send|reply|forward)([_-]|$)/i;
const DELETE_VERBS = /(^|[_-])(delete|trash|destroy|purge|erase)([_-]|$)/i;
const POST_VERBS = /(^|[_-])(post|publish|tweet|comment|share)([_-]|$)/i;
const PAY_VERBS =
  /(^|[_-])(pay|payment|charge|purchase|checkout|buy|refund|payout|transfer)([_-]|$)/i;

const MAC_SETTING_PERMISSION: Record<MacToolSetting, ToolPermission> = {
  allowed: "allow",
  ask: "ask",
  off: "deny",
};

function macToolPermissionState(
  tool: Pick<PermissionTool, "name">,
  policy: ToolPermissionPolicy,
): ToolPermissionState | null {
  const entry = macAppToolEntry(tool.name);
  if (!entry) return null;
  const connectorKind = entry.app.connectorKind;
  const actionRule = evaluateActionRules({
    rules: policy.actionRules,
    actions: [{ name: tool.name, connectorKind }],
    initiator: "you",
  })?.effect;
  const listed = resolveActionApprovalDetail({
    toolName: tool.name,
    connectorKind,
    rules: [...policy.approvalRules],
  });
  if (listed.decision === "deny" || actionRule === "deny") return "deny";
  if (entry.tool.kind === "send") return "ask";
  if (actionRule === "ask" || listed.source === "require_approval") return "ask";
  if (actionRule === "allow" || listed.source === "always_allow") return "allow";
  return entry.tool.byDefault === "asks-every-time" ? "ask" : "once";
}

export function toolPermissionChoices(tool: Pick<PermissionTool, "name">): ToolPermission[] {
  const entry = macAppToolEntry(tool.name);
  return entry
    ? entry.tool.settings.map((setting) => MAC_SETTING_PERMISSION[setting])
    : [...TOOL_PERMISSIONS];
}

export function toolPermissionState(
  tool: Pick<PermissionTool, "name" | "readOnly">,
  policy: ToolPermissionPolicy,
): ToolPermissionState {
  const mac = macToolPermissionState(tool, policy);
  if (mac) return mac;
  const actionRule = evaluateActionRules({
    rules: policy.actionRules,
    actions: [{ name: tool.name, readOnly: tool.readOnly }],
    initiator: "you",
  });
  const plan = planActionGate({
    resolved: resolveActionApprovalDetail({
      toolName: tool.name,
      readOnly: tool.readOnly,
      rules: [...policy.approvalRules],
    }),
    mode: policy.mode,
    mandatory: toolRequiresExplicitApproval(tool.name),
    consequential: toolRequiresApproval(tool.name, true, tool.readOnly),
    checkerConfigured: policy.mode === "auto" && policy.checkerAvailable,
    actionRule: actionRule?.effect,
  });
  return plan === "judge" ? "review" : plan;
}

export function toolPermissionEditable(tool: Pick<PermissionTool, "name">): boolean {
  return (
    !tool.name.includes("*") && ActionRuleSchema.safeParse(toolRule(tool.name, "deny")).success
  );
}

function ownsTool(rule: ActionRule, toolName: string): boolean {
  return (
    rule.matchKind === "tool" &&
    rule.initiator === null &&
    rule.matchValue.toLowerCase() === toolName.toLowerCase()
  );
}

function stableId(toolName: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (const char of toolName.toLowerCase()) {
    const code = char.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
  }
  return `tool-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function toolRule(toolName: string, effect: ToolPermission): ActionRule {
  return {
    id: stableId(toolName),
    matchKind: "tool",
    matchValue: toolName,
    initiator: null,
    effect,
  };
}

export class ToolPermissionLimitError extends Error {
  constructor() {
    super(`An account keeps at most ${ACTION_RULES_MAX} action rules.`);
    this.name = "ToolPermissionLimitError";
  }
}

export function withToolPermissions(
  policy: ToolPermissionPolicy,
  tools: readonly Pick<PermissionTool, "name" | "readOnly">[],
  permission: ToolPermission,
): ActionRule[] {
  const editable = tools.filter(
    (tool) => toolPermissionEditable(tool) && toolPermissionChoices(tool).includes(permission),
  );
  const others = policy.actionRules.filter(
    (rule) => !editable.some((tool) => ownsTool(rule, tool.name)),
  );
  const without = { ...policy, actionRules: others };
  const added = editable
    .filter((tool) => toolPermissionState(tool, without) !== permission)
    .map((tool) => toolRule(tool.name, permission));
  const next = [...added, ...others];
  if (next.length > ACTION_RULES_MAX) throw new ToolPermissionLimitError();
  return next;
}

export function riskyCapability(
  tool: Pick<PermissionTool, "name" | "readOnly">,
  appSlug: string,
): RiskyCapability | null {
  const mac = macAppToolEntry(tool.name);
  if (mac) {
    if (mac.tool.kind !== "send") return null;
    return categoryMatches("email", tool.name, mac.app.connectorKind, false) ? "email" : "message";
  }
  if (!connectorToolRequiresApproval(tool.name, tool.readOnly)) return null;
  const connectorKind = connectorKindFromToolName(tool.name, [appSlug]);
  if (
    PAY_VERBS.test(tool.name) ||
    categoryMatches("purchase", tool.name, connectorKind, tool.readOnly)
  )
    return "pay";
  if (DELETE_VERBS.test(tool.name)) return "delete";
  if (SEND_VERBS.test(tool.name))
    return categoryMatches("email", tool.name, connectorKind, tool.readOnly) ? "email" : "message";
  if (POST_VERBS.test(tool.name)) return "post";
  return null;
}

export type ToolGroup<Tool extends PermissionTool> = {
  lookups: Tool[];
  actions: Tool[];
};

function changesThings(tool: Pick<PermissionTool, "name" | "readOnly">): boolean {
  const mac = macAppToolEntry(tool.name);
  return mac ? mac.tool.kind !== "read" : connectorToolRequiresApproval(tool.name, tool.readOnly);
}

export function groupToolsByEffect<Tool extends PermissionTool>(
  tools: readonly Tool[],
): ToolGroup<Tool> {
  const byLabel = (left: Tool, right: Tool) => left.label.localeCompare(right.label);
  return {
    lookups: tools.filter((tool) => !changesThings(tool)).sort(byLabel),
    actions: tools.filter(changesThings).sort(byLabel),
  };
}

function ownsConnector(rule: ActionRule, connectorKind: string): boolean {
  return (
    rule.matchKind === "connector" &&
    rule.initiator === null &&
    rule.effect === "deny" &&
    rule.matchValue.toLowerCase() === connectorKind.toLowerCase()
  );
}

export function appTurnedOff(policy: ToolPermissionPolicy, connectorKind: string): boolean {
  return policy.actionRules.some((rule) => ownsConnector(rule, connectorKind));
}

export function withAppTurnedOff(
  policy: ToolPermissionPolicy,
  connectorKind: string,
  off: boolean,
): ActionRule[] {
  const others = policy.actionRules.filter((rule) => !ownsConnector(rule, connectorKind));
  if (!off) return others;
  const rule: ActionRule = {
    id: stableId(`connector:${connectorKind}`),
    matchKind: "connector",
    matchValue: connectorKind,
    initiator: null,
    effect: "deny",
  };
  const next = [rule, ...others];
  if (next.length > ACTION_RULES_MAX) throw new ToolPermissionLimitError();
  return next;
}

export function sharedPermissionState(
  tools: readonly Pick<PermissionTool, "name" | "readOnly">[],
  policy: ToolPermissionPolicy,
): ToolPermissionState | "mixed" | null {
  const states = new Set(tools.map((tool) => toolPermissionState(tool, policy)));
  if (states.size === 0) return null;
  if (states.size > 1) return "mixed";
  const [state] = states;
  return state ?? null;
}

export function guardedCapabilities(
  tools: readonly Pick<PermissionTool, "name" | "readOnly">[],
  appSlug: string,
  policy: ToolPermissionPolicy,
): RiskyCapability[] {
  const guarded = new Set<RiskyCapability>();
  for (const tool of tools) {
    const capability = riskyCapability(tool, appSlug);
    if (capability && toolPermissionState(tool, policy) === "ask") guarded.add(capability);
  }
  return RISKY_CAPABILITIES.filter((capability) => guarded.has(capability));
}

export function mcpPermissionToolName(serverSlug: string, toolName: string): string {
  return `mcp__${serverSlug}__${toolName}`;
}
