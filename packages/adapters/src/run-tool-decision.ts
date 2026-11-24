import type { ActionRuleVerdict, ApprovalMode } from "@robots/core";
import { humanizeToolName } from "@robots/core";
import { tryRecordAuditEvent } from "@robots/db";
import type { DuplicateEffectGate } from "./approval-effect.js";
import type { RunContext } from "./run-context.js";

export type ToolDecision = {
  decision: "allowed" | "asked" | "approved" | "denied";
  basis: "rule" | "invalid_rule" | "list" | "review" | "mode" | "person" | "policy";
  rule?: ActionRuleVerdict;
  reason?: string;
  effectId?: string;
};

export function actionRuleName(verdict: ActionRuleVerdict): string {
  const position = verdict.index + 1;
  return verdict.basis === "rule"
    ? `#${position} (${JSON.stringify(verdict.rule.matchValue)})`
    : `#${position}`;
}

export function decisionBeforeAct(input: {
  duplicate: DuplicateEffectGate["action"] | undefined;
  effectStatus: string | undefined;
  effectRecorded: boolean;
  needsApproval: boolean;
  actionRule: ActionRuleVerdict | undefined;
  policyAsks: boolean;
  reviewed: boolean;
  listAllows: boolean;
  listAsks: boolean;
}): ToolDecision | undefined {
  const { actionRule } = input;
  const own = (decision: "allowed" | "asked"): ToolDecision => {
    if (actionRule && (actionRule.effect === "ask") === (decision === "asked")) {
      return { decision, basis: actionRule.basis, rule: actionRule };
    }
    if (decision === "asked" && input.policyAsks) return { decision, basis: "policy" };
    if (input.reviewed) return { decision, basis: "review" };
    if (decision === "allowed" ? input.listAllows : input.listAsks)
      return { decision, basis: "list" };
    return { decision, basis: "mode" };
  };
  switch (input.duplicate) {
    case undefined:
      if (input.needsApproval && input.effectRecorded) return own("asked");
      return input.effectRecorded || actionRule ? own("allowed") : undefined;
    case "execute":
      return { decision: "approved", basis: "person" };
    case "return":
      return input.effectStatus === "denied" ? { decision: "denied", basis: "person" } : undefined;
    case "paused":
      return own(input.needsApproval ? "asked" : "allowed");
    case "uncertain":
      return undefined;
  }
}

export function recordToolDecision(
  ctx: RunContext,
  tool: string,
  mode: ApprovalMode,
  decision: ToolDecision,
): Promise<boolean> {
  const { rule } = decision;
  return tryRecordAuditEvent({
    action: "tool.decision",
    actor: { type: "bot", id: ctx.bot.id, label: ctx.bot.name },
    spaceId: ctx.run.spaceId,
    target: { type: "tool", id: tool, label: humanizeToolName(tool) },
    outcome: decision.decision === "denied" ? "denied" : "success",
    runId: ctx.runId,
    threadId: ctx.thread.id,
    metadata: {
      decision: decision.decision,
      basis: decision.basis,
      initiator: ctx.trust.initiator,
      mode,
      reason: decision.reason,
      effectId: decision.effectId,
      ruleId: rule?.basis === "rule" ? rule.rule.id : undefined,
      rulePosition: rule ? rule.index + 1 : undefined,
    },
  });
}
