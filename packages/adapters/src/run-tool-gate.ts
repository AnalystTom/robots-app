import type {
  AdapterContext,
  AgentToolExecutionObserver,
  AutoReviewRequest,
  ConnectorCall,
  ToolBatch,
} from "@robots/adapter-kit";
import {
  applyJudgeDecision,
  approvalModeFromPreference,
  BACKGROUND_HELPER_TRIGGER,
  batchActions,
  connectorKindFromToolName,
  connectorReadRequiresApproval,
  connectorToolRequiresApproval,
  decisiveActionApprovalRules,
  displayName,
  evaluateActionRules,
  humanizeToolName,
  memoryWriteNeedsApproval,
  newSiteOutcome,
  outboundSiteGate,
  outsideRunToolRequiresApproval,
  planActionGate,
  redactSecrets,
  repeatsDeniedAction,
  resolveActionApprovalForTools,
  SITE_SENDING_TOOLS,
  toolRequiresApproval,
  toolRequiresExplicitApproval,
} from "@robots/core";
import { normalizedHttpUrl, urlSite } from "@robots/core/egress";
import { approvalEffectKey, toolEffectIdempotencyKey } from "@robots/core/node/approval-effect-key";
import type { AuditEventInput } from "@robots/db";
import { recordAuditEvent, runSecretKind } from "@robots/db";
import type { FleetCardSummary } from "./approval-ask.js";
import { buildApprovalAskBlock, MAX_FETCH_URL_LENGTH } from "./approval-ask.js";
import {
  boundDirectApprovalDetails,
  DENIED_ACTION_ERROR,
  resolveDuplicateEffectGate,
  settleUncertainEffect,
  uncertainEffectResult,
} from "./approval-effect.js";
import type { AutoReviewChecker } from "./auto-review.js";
import {
  isAutoReviewCheckerConfigured,
  redactToolArgsForReview,
  resolveAutoReviewChecker,
} from "./auto-review.js";
import { reviewWithBackups } from "./auto-review-backups.js";
import { ROBOTS_DOCS_URLS } from "./builtin-skills.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { CATALOG_LOAD, CATALOG_SEARCH } from "./lazy-tool-catalog.js";
import { findConnectedModelCredential } from "./model-selection.js";
import { paidRequestEffect } from "./paid-request.js";
import type { PurchaseApproval } from "./purchase-gate.js";
import { PURCHASE_CHECKED_TOOLS, purchaseApprovalOf } from "./purchase-gate.js";
import { autoReviewCheckerProvider } from "./run-auto-review.js";
import type { RunContext, RunTrust } from "./run-context.js";
import {
  isRunTainted,
  nextMutatingEffectOccurrence,
  pauseForApproval,
  pauseForSecret,
  persistTurnCheckpoint,
} from "./run-context.js";
import {
  CATALOG_APPROVAL_TOOL,
  claimEffect,
  completeEffect,
  recordEffect,
  uncertainEffectError,
} from "./run-effects.js";
import { enqueueSteeringContinuation, renewRunLease } from "./run-lifecycle.js";
import { notifyRun } from "./run-notifications.js";
import { resolveCompletedSecretLeftover } from "./run-secret.js";
import type { ToolDecision } from "./run-tool-decision.js";
import { actionRuleName, decisionBeforeAct, recordToolDecision } from "./run-tool-decision.js";
import type { ToolRequest } from "./run-tool-request.js";
import { BUILTIN_AGENT_TOOL_NAMES, READ_ONLY_AGENT_TOOLS } from "./run-tool-selection.js";
import { callMediaTool } from "./run-tools-files.js";
import { callPaidService } from "./run-tools-integrations.js";
import { USER_COMPUTER_TOOLS, userComputerGate } from "./run-tools-user-computer.js";
import { connectorTrustKeys } from "./run-trust.js";
import { watchFromTool } from "./schedule-tools.js";
import { pagePaymentPrecheck, paysWithWallet } from "./spending-gate.js";
import { refusal } from "./tool-refusal.js";

export type AppliedEffect = Awaited<ReturnType<typeof recordEffect>>;

type ApprovalCard = {
  reviewReason: string | undefined;
  summary: FleetCardSummary | undefined;
  batch: ToolBatch | undefined;
  onceOnly: boolean;
};

export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly executionId: string;
  readonly observer: AgentToolExecutionObserver | undefined;
  readonly connectorCall: ConnectorCall;
  readonly effectKey: string;
  readonly applied: AppliedEffect | undefined;
  readonly nextApprovedTool: string | undefined;
  readonly bypassApproval: boolean;
  readonly spend: PurchaseApproval | undefined;
  claimedEffect: boolean;
  readonly persistEffectResult: (result: unknown) => Promise<boolean>;
  readonly finish: (result: unknown) => Promise<unknown>;
  readonly claimOrReturn: (from: "approved" | "intended") => Promise<unknown | undefined>;
}

export type ToolHandler = (ctx: RunContext, call: ToolCall) => Promise<unknown>;
export type ToolHandlers = Record<string, ToolHandler>;

type GateOutcome = { result: unknown; replayed?: true } | { call: ToolCall };

type ToolReview = {
  name: string;
  args: Record<string, unknown>;
  connectorKind: ReturnType<typeof connectorKindFromToolName>;
  newSite: boolean;
  memoryWrite: boolean;
  fetchUrl: string | undefined;
  matchingRules: ReturnType<typeof resolveActionApprovalForTools>["matchingRules"];
  gated: boolean;
  applied: AppliedEffect | undefined;
  injectedReview: ExecutorDeps["autoReview"];
  checker: AutoReviewChecker | null | undefined;
  reviewSettings: Awaited<ReturnType<RunTrust["loadApprovalModel"]>> | null;
  memberChecker: boolean;
};

export async function gateToolCall(
  ctx: RunContext,
  request: ToolRequest,
  observer: AgentToolExecutionObserver | undefined,
): Promise<GateOutcome> {
  const { deps, run, runId, context } = ctx;
  const { name, executionId, connectorCall, resolvedTool, nextApprovedTool, approvedEffectKey } =
    request;
  const { replayEffectToolName } = request;
  let { args, effectRequest } = request;
  const viaConnector = !BUILTIN_AGENT_TOOL_NAMES.has(name);
  const connectorTool = viaConnector ? (resolvedTool ?? ctx.tools.connector.get(name)) : undefined;
  const declaredReadOnly = connectorTool?.readOnly;
  const batch = connectorTool?.batch ? batchActions(connectorTool.batch, args) : undefined;
  const unidentifiedAction = Boolean(batch && !batch.complete);
  const approvalName = connectorCall.route?.connectionId ? connectorCall.route.toolName : name;
  const approvalToolNames = batch?.actions.length ? batch.actions : [approvalName];
  const catalogControlRead =
    !connectorCall.route?.connectionId &&
    !connectorCall.route?.resourceId &&
    (connectorCall.route?.toolName === CATALOG_SEARCH ||
      connectorCall.route?.toolName === CATALOG_LOAD);
  const declaredReadOnlyFor = (toolName: string) =>
    toolName === approvalName || toolName === name || declaredReadOnly === false
      ? declaredReadOnly
      : ctx.tools.connector.get(toolName)?.readOnly;
  if (
    run.trigger === BACKGROUND_HELPER_TRIGGER &&
    viaConnector &&
    !catalogControlRead &&
    (unidentifiedAction ||
      approvalToolNames.some((toolName) => declaredReadOnlyFor(toolName) !== true))
  ) {
    return {
      result: refusal(
        "helper_read_only",
        `${name} can change something, and a background helper may only read. Don't retry; say in your result what the bot should do.`,
      ),
    };
  }
  const connectorProviders = ctx.tools.connectedPlugins.map((plugin) => plugin.provider);
  const connectorKind = connectorKindFromToolName(approvalName, connectorProviders);
  const watch = name === "schedule_create" ? watchFromTool(args.watch) : undefined;
  const httpWatch = watch?.kind === "http";
  const sendsToSite =
    httpWatch || (SITE_SENDING_TOOLS.has(name) && (name === "web_fetch" || args.url !== undefined));
  const fetchUrl = sendsToSite
    ? normalizedHttpUrl(String(httpWatch ? watch.url : (args.url ?? "")))
    : undefined;
  const fetchSite = fetchUrl ? urlSite(fetchUrl) : undefined;
  if (sendsToSite && !fetchSite)
    return { result: refusal("fetch_url_invalid", "url must be an http(s) URL") };
  if (fetchUrl && fetchUrl.length > MAX_FETCH_URL_LENGTH)
    return {
      result: refusal(
        "fetch_url_too_long",
        `url must be at most ${MAX_FETCH_URL_LENGTH} characters`,
      ),
    };
  if (fetchUrl) {
    args = httpWatch ? { ...args, watch: { ...watch, url: fetchUrl } } : { ...args, url: fetchUrl };
    effectRequest = name === "paid_request" ? paidRequestEffect(args) : args;
  }
  const connectorTrusts = connectorTrustKeys(
    batch?.actions,
    connectorCall.route,
    connectorKind,
    connectorProviders,
  );
  const siteGate =
    fetchUrl && fetchSite
      ? outboundSiteGate({
          site: fetchSite,
          trusted:
            ctx.trust.searchResultUrls.has(fetchUrl) ||
            (name === "web_fetch" && ROBOTS_DOCS_URLS.includes(fetchUrl)) ||
            (await ctx.trust.loadTrustedSites()).has(fetchSite),
          rules: await ctx.trust.loadApprovalRules(),
        })
      : "allow";
  const watchedTool = watch?.kind === "tool" ? watch.tool : undefined;
  const readTrusts = watchedTool
    ? connectorTrustKeys(
        undefined,
        ctx.tools.connector.get(watchedTool)?.route,
        connectorKindFromToolName(watchedTool, connectorProviders),
        connectorProviders,
      )
    : viaConnector &&
        !unidentifiedAction &&
        (catalogControlRead ||
          approvalToolNames.every(
            (toolName) => !connectorToolRequiresApproval(toolName, declaredReadOnlyFor(toolName)),
          ))
      ? connectorTrusts
      : undefined;
  const connectorReadGated =
    readTrusts !== undefined &&
    connectorReadRequiresApproval({
      tainted: await isRunTainted(ctx),
      connectorTrusted: await ctx.trust
        .loadTrustedConnectors()
        .then((trusted) => readTrusts.every((trust) => trusted.has(trust))),
    });
  const unattendedWatch = watch?.kind === "command" || httpWatch;
  const scheduleNamesNewSite =
    (name === "schedule_create" ||
      name === "create_child_routine" ||
      (name === "schedule_update" && Boolean(args.prompt))) &&
    (await isRunTainted(ctx)) &&
    (await ctx.trust.routineNamesNewSite(String(args.prompt ?? "")));
  const memoryWriteGated = await memoryWriteNeedsApproval(name, () => isRunTainted(ctx));
  const { purchase, cardUse, loginUse } = request;
  const paying = Boolean(purchase) || Boolean(cardUse) || Boolean(loginUse);
  const requiresApprovalByDefault =
    request.heldForApproval ||
    paying ||
    unattendedWatch ||
    siteGate === "new" ||
    memoryWriteGated ||
    unidentifiedAction ||
    (!catalogControlRead &&
      approvalToolNames.some(
        (toolName) =>
          toolRequiresApproval(toolName, viaConnector, declaredReadOnlyFor(toolName)) ||
          (!viaConnector && outsideRunToolRequiresApproval(run.trigger, toolName)),
      ));
  const gated = requiresApprovalByDefault || connectorReadGated;
  const mandatoryInAnyRun =
    paying || unattendedWatch || scheduleNamesNewSite || toolRequiresExplicitApproval(name);
  const asksEveryTime =
    (unattendedWatch || scheduleNamesNewSite) && !toolRequiresApproval(name, viaConnector);
  const guardedInNeverAsk = name === "respond_agent_connection";
  const approvalSubjects = approvalToolNames.map((toolName) => ({
    name: toolName,
    aliases: toolName === approvalName && approvalName !== name ? [name] : undefined,
    connectorKind:
      toolName === approvalName
        ? connectorKind
        : connectorKindFromToolName(toolName, connectorProviders),
    readOnly: declaredReadOnlyFor(toolName),
  }));
  const wrapperSubject = batch ? { name, connectorKind } : undefined;
  const resolvedRules = resolveActionApprovalForTools({
    tools: approvalSubjects,
    wrapper: wrapperSubject,
    site: fetchSite,
    rules: await ctx.trust.loadApprovalRules(),
  });
  const approvalResolved =
    unidentifiedAction && resolvedRules.decision === "allow"
      ? { ...resolvedRules, decision: "ask" as const }
      : resolvedRules;
  const ruleVerdict = evaluateActionRules({
    rules: await ctx.trust.loadActionRules(),
    actions: approvalSubjects,
    wrapper: wrapperSubject,
    initiator: ctx.trust.initiator,
  });
  const actionRule =
    unidentifiedAction && ruleVerdict?.effect === "allow" ? undefined : ruleVerdict;
  const mode = approvalModeFromPreference(await ctx.trust.loadAutoReviewPreference());
  const decide = (decision: ToolDecision) => recordToolDecision(ctx, name, mode, decision);
  const reviewable = mode === "auto" && !mandatoryInAnyRun;
  const injectedReview = reviewable ? deps.autoReview : undefined;
  const reviewSettings = !reviewable || injectedReview ? null : await ctx.trust.loadApprovalModel();
  const memberChecker = reviewSettings?.primarySource === "member";
  const checker = !reviewable
    ? undefined
    : reviewSettings
      ? reviewSettings.primary
        ? {
            provider: reviewSettings.primary.provider,
            model: reviewSettings.primary.modelId,
            thinkingLevel: reviewSettings.primary.thinkingLevel,
            credentialId: reviewSettings.primary.credentialId,
          }
        : null
      : resolveAutoReviewChecker();
  const checkerConfigured =
    reviewable &&
    (Boolean(injectedReview) ||
      memberChecker ||
      Boolean(reviewSettings?.backups.length) ||
      (checker
        ? isAutoReviewCheckerConfigured({}) ||
          Boolean(
            await findConnectedModelCredential(
              deps.prisma,
              deps.secretStore,
              { userId: run.userId, spaceId: run.spaceId },
              checker.provider,
            ),
          )
        : false));
  const plan = USER_COMPUTER_TOOLS.has(name)
    ? await userComputerGate(
        ctx,
        approvalResolved.decision === "deny" || actionRule?.effect === "deny",
        name,
        args,
      ).then((planned) => (planned === "allow" && actionRule?.effect === "ask" ? "ask" : planned))
    : planActionGate({
        resolved: approvalResolved,
        mode,
        mandatory: mandatoryInAnyRun,
        steerable:
          guardedInNeverAsk && mode === "never"
            ? !ctx.source.ownerStartedRun || (await isRunTainted(ctx))
            : undefined,
        consequential: requiresApprovalByDefault,
        reviewOnly: connectorReadGated,
        checkerConfigured,
        newDestination: siteGate === "new",
        purchase: paying,
        actionRule: actionRule?.effect,
      });
  if (paying && run.trigger === "webhook" && plan !== "deny") {
    await decide({
      decision: "denied",
      basis: "policy",
      reason: loginUse ? "login_unattended" : "purchase_unattended",
    });
    return {
      result: refusal(
        loginUse ? "login_needs_approval_unattended" : "purchase_needs_approval_unattended",
        `This would ${loginUse ? "sign in with a saved login" : "complete a purchase"}, which needs the user's approval, and a webhook run cannot ask. Don't retry; tell the user.`,
      ),
    };
  }
  if (plan === "deny") {
    if (actionRule?.effect === "deny") {
      await decide({ decision: "denied", basis: "rule", rule: actionRule });
      return {
        result: refusal(
          "action_rule_denied",
          `${humanizeToolName(name)} is not allowed: your action rule ${actionRuleName(actionRule)} denies it. Don't try it another way; tell the user it isn't allowed by their action rules.`,
        ),
      };
    }
    await decide({
      decision: "denied",
      basis: approvalResolved.decision === "deny" ? "list" : "mode",
    });
    return {
      result: refusal(
        "approval_denied",
        approvalResolved.decision === "deny"
          ? `${name} is blocked in this space${blockingRuleSuffix(approvalResolved)}. Don't try it another way; tell the user it's blocked.`
          : `${name} needs the owner's approval because it could have been asked for by someone else, and this space never asks. Don't retry; tell the user.`,
      ),
    };
  }
  const spends = purchase && !paysWithWallet(args) ? purchase : undefined;
  if (spends && nextApprovedTool !== name) {
    const spender = {
      userId: run.userId,
      spaceId: run.spaceId,
      botId: ctx.bot.id,
      threadId: ctx.thread.id,
    };
    const refused = await pagePaymentPrecheck(deps.prisma, spender, spends);
    if (refused) {
      await decide({ decision: "denied", basis: "policy", reason: "spending_limit" });
      return { result: refusal("spending_limit", refused) };
    }
  }
  let reviewReason: string | undefined;
  let gateDecision: "ask" | "allow" = plan === "ask" ? "ask" : "allow";
  const needsApprovalEarly = plan === "ask" || plan === "judge";
  const usesApprovalKey =
    nextApprovedTool || name === "request_secret" || needsApprovalEarly || gated;
  const occurrence =
    (name === "request_secret" && args.oneTimeCode === undefined) || name === "connect_app"
      ? 0
      : nextMutatingEffectOccurrence(
          ctx,
          replayEffectToolName,
          args,
          executionId,
          approvedEffectKey,
        );
  const effectKey =
    approvedEffectKey ??
    (usesApprovalKey && occurrence === 0
      ? approvalEffectKey(runId, replayEffectToolName, args)
      : toolEffectIdempotencyKey(runId, replayEffectToolName, args, occurrence));
  const applied =
    READ_ONLY_AGENT_TOOLS.has(name) &&
    siteGate !== "new" &&
    plan !== "ask" &&
    nextApprovedTool !== name &&
    !approvedEffectKey
      ? undefined
      : await recordEffect(
          deps,
          run,
          replayEffectToolName,
          effectKey,
          effectRequest,
          executionId,
          ctx.state.effects.consumedIds,
          batch && (batch.complete ? batch.actions : []),
        );

  const pageAction = PURCHASE_CHECKED_TOOLS.has(name);
  const repeatChecked =
    applied &&
    (!applied.duplicate || applied.effect.status === "intended") &&
    !["web_fetch", "secret_request", "request_secret", "connect_app"].includes(name);
  const deniedEarlier = repeatChecked
    ? (
        await deps.prisma.externalEffect.findMany({
          where: { runId, status: "denied", kind: replayEffectToolName },
          select: { request: true, result: true },
        })
      ).flatMap((effect) =>
        effect.result == null &&
        (!pageAction ||
          purchaseApprovalOf(
            (effect.request as { purchaseApproval?: unknown } | null)?.purchaseApproval,
          )?.site === purchase?.site)
          ? [
              boundDirectApprovalDetails(effect.request, CATALOG_APPROVAL_TOOL)?.args ??
                effect.request,
            ]
          : [],
      )
    : [];
  if (
    applied &&
    repeatsDeniedAction({ toolName: replayEffectToolName, args, denied: deniedEarlier })
  ) {
    await deps.prisma.externalEffect.updateMany({
      where: { id: applied.effect.id, status: "intended" },
      data: { status: "denied", result: { refused: "repeat" } },
    });
    await decide({
      decision: "denied",
      basis: "policy",
      reason: "repeat",
      effectId: applied.effect.id,
    });
    return { result: refusal("action_denied_repeat", DENIED_ACTION_ERROR) };
  }

  const runAutoReview = async () => {
    const judged = await reviewToolCall(ctx, {
      name,
      args,
      connectorKind,
      newSite: siteGate === "new",
      memoryWrite: memoryWriteGated,
      fetchUrl,
      matchingRules: approvalResolved.matchingRules,
      gated,
      applied,
      injectedReview,
      checker,
      reviewSettings,
      memberChecker,
    });
    if (!judged) return;
    reviewReason = judged.reason;
    gateDecision = judged.decision;
  };

  if (applied && plan === "judge" && (injectedReview || checker)) {
    if (!applied.duplicate) {
      await runAutoReview();
    } else {
      const priorDecision = applied.effect.reviewDecision;
      if (priorDecision === "ask" || priorDecision === "error") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "ask";
      } else if (priorDecision === "pass") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "allow";
      } else {
        await runAutoReview();
      }
    }
  } else if (applied?.duplicate && plan === "ask") {
    gateDecision = "ask";
  }
  if (context.signal.aborted) return { result: pauseForApproval(ctx) };
  if (
    siteGate === "new" &&
    newSiteOutcome({ trigger: run.trigger, decision: gateDecision }) === "deny"
  ) {
    if (applied) {
      await deps.prisma.externalEffect.updateMany({
        where: { id: applied.effect.id, status: "intended" },
        data: { status: "denied" },
      });
    }
    await decide({ decision: "denied", basis: "policy", reason: "new_site_unattended" });
    return {
      result: refusal(
        "fetch_needs_approval_unattended",
        `Fetching ${fetchSite} needs approval, and a webhook run cannot ask.`,
      ),
    };
  }

  const needsApproval = gateDecision === "ask";
  if (needsApproval && run.trigger === BACKGROUND_HELPER_TRIGGER) {
    if (applied) {
      await deps.prisma.externalEffect.updateMany({
        where: { id: applied.effect.id, status: "intended" },
        data: { status: "denied" },
      });
    }
    await decide({ decision: "denied", basis: "policy", reason: "helper_cannot_ask" });
    return {
      result: refusal(
        "helper_cannot_ask_approval",
        `${name} needs the owner's approval, and a background helper cannot ask. Don't retry; say in your result what the bot should ask for.`,
      ),
    };
  }
  const call = createToolCall(ctx, {
    name,
    args,
    executionId,
    observer,
    connectorCall,
    effectKey,
    applied,
    nextApprovedTool,
    bypassApproval: gateDecision === "allow" && gated,
    spend: spends,
  });
  const card = {
    reviewReason,
    summary: request.fleetSummary,
    batch: connectorTool?.batch,
    onceOnly: asksEveryTime,
  };

  const duplicateGate = applied?.duplicate
    ? resolveDuplicateEffectGate(applied.effect, name)
    : undefined;
  const decision = decisionBeforeAct({
    duplicate: duplicateGate?.action,
    effectStatus: applied?.effect.status,
    effectRecorded: Boolean(applied),
    needsApproval,
    actionRule,
    policyAsks: paying || mandatoryInAnyRun,
    reviewed: plan === "judge",
    listAllows: approvalResolved.source === "always_allow",
    listAsks: approvalResolved.decision === "ask",
  });
  if (
    decision &&
    !(await decide({ ...decision, effectId: applied?.effect.id })) &&
    decision.decision !== "denied"
  ) {
    return {
      result: refusal(
        "audit_unavailable",
        `${name} did not run because its decision could not be written to the audit log. Don't retry now; tell the user.`,
      ),
    };
  }
  if (applied && duplicateGate) {
    const gate = duplicateGate;
    if (gate.action === "return") {
      if (name === "request_secret") {
        const replacementSecret = await deps.prisma.secret.findFirst({
          where: {
            spaceId: run.spaceId,
            userId: run.userId,
            kind: runSecretKind(runId),
          },
          select: { id: true, createdAt: true },
        });
        if (!replacementSecret) return { result: gate.result, replayed: true };
        const effectUpdatedAt = applied.effect.updatedAt;
        if (
          !(effectUpdatedAt instanceof Date) ||
          resolveCompletedSecretLeftover({
            secretCreatedAt: replacementSecret.createdAt,
            effectUpdatedAt,
          }) === "drop_leftover"
        ) {
          await deps.prisma.secret.delete({
            where: { id: replacementSecret.id },
          });
          return { result: gate.result, replayed: true };
        }
      } else {
        return { result: gate.result, replayed: true };
      }
    }
    if (gate.action === "paused") {
      if (name === "request_secret") {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForSecret(ctx) };
        }
      } else if (!needsApproval) {
        const early = await call.claimOrReturn("intended");
        if (early !== undefined) return { result: early, replayed: true };
      } else {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForApproval(ctx) };
        }
        return { result: await requestApproval(ctx, call, card) };
      }
    } else if (gate.action === "uncertain") {
      return {
        result: await settleToolUncertainty(ctx, call, applied.effect.id, gate.toolName),
        replayed: true,
      };
    } else if (gate.action === "execute") {
      const early = await call.claimOrReturn("approved");
      if (early !== undefined) return { result: early, replayed: true };
    }
  } else if (needsApproval && applied) {
    return { result: await requestApproval(ctx, call, card) };
  } else if (call.bypassApproval && applied) {
    const early = await call.claimOrReturn("intended");
    if (early !== undefined) return { result: early, replayed: true };
  }
  if (fetchSite && siteGate === "new") (await ctx.trust.loadTrustedSites()).add(fetchSite);
  if (viaConnector) {
    const trusted = await ctx.trust.loadTrustedConnectors();
    for (const trust of connectorTrusts) trusted.add(trust);
  }
  return { call };
}

export async function auditToolCall(
  ctx: RunContext,
  tool: string,
  outcome: "success" | "failure" | "denied",
  metadata: AuditEventInput["metadata"],
  recorded: Pick<AuditEventInput, "action" | "actor"> = {
    action: "tool.call",
    actor: { type: "bot", id: ctx.bot.id, label: ctx.bot.name },
  },
): Promise<void> {
  await recordAuditEvent({
    ...recorded,
    spaceId: ctx.run.spaceId,
    target: { type: "tool", id: tool, label: humanizeToolName(tool) },
    outcome,
    runId: ctx.runId,
    threadId: ctx.thread.id,
    metadata,
  });
}

function blockingRuleSuffix(resolved: ReturnType<typeof resolveActionApprovalForTools>): string {
  const labels = decisiveActionApprovalRules(resolved).map((rule) => {
    const value = rule.matchValue.trim().replace(/\s+/g, " ");
    return JSON.stringify(rule.matchKind === "site" ? value : humanizeToolName(value));
  });
  if (labels.length === 0) return "";
  return ` by the saved ${labels.length === 1 ? "rule" : "rules"} ${labels.join(", ")}`;
}

function createToolCall(
  ctx: RunContext,
  fields: Omit<ToolCall, "claimedEffect" | "persistEffectResult" | "finish" | "claimOrReturn">,
): ToolCall {
  const { deps } = ctx;
  const { name, args, applied } = fields;
  const call: ToolCall = {
    ...fields,
    claimedEffect: false,
    persistEffectResult: (result) =>
      applied
        ? completeEffect(
            deps,
            applied.effect.id,
            call.claimedEffect ? "executing" : "intended",
            result,
          )
        : Promise.resolve(true),
    finish: async (result) =>
      (await call.persistEffectResult(result)) ? result : uncertainEffectResult(name, args),
    claimOrReturn: async (from) => {
      if (await claimEffect(deps, ctx.runId, applied!.effect.id, from)) {
        call.claimedEffect = true;
        return undefined;
      }
      const current = await deps.prisma.externalEffect.findUnique({
        where: { id: applied!.effect.id },
      });
      if (current) {
        const retryGate = resolveDuplicateEffectGate(current, name);
        if (retryGate.action === "return") return retryGate.result;
        if (retryGate.action === "uncertain") {
          return settleToolUncertainty(ctx, call, applied!.effect.id, name);
        }
      }
      throw uncertainEffectError(name);
    },
  };
  return call;
}

async function settleToolUncertainty(
  ctx: RunContext,
  call: ToolCall,
  effectId: string,
  toolName: string,
) {
  if (call.name === "generate_image" || call.name === "generate_video") {
    const recovered = await callMediaTool(ctx, call, true);
    if (
      recovered !== undefined &&
      (await completeEffect(ctx.deps, effectId, "executing", recovered))
    )
      return recovered;
  }
  if (call.name === "service_call") {
    const recovered = await callPaidService(ctx, call).catch(() => undefined);
    if (
      recovered &&
      "cost_usd" in recovered &&
      (await completeEffect(ctx.deps, effectId, "executing", recovered))
    )
      return recovered;
  }
  return settleUncertainEffect(ctx.deps.prisma, effectId, toolName, call.args);
}

function requestApproval(ctx: RunContext, call: ToolCall, card: ApprovalCard) {
  const { approval } = ctx.state;
  if (approval.request) return approval.request.then(() => pauseForApproval(ctx));
  approval.request = showApprovalCard(ctx, call, card);
  return approval.request;
}

async function showApprovalCard(ctx: RunContext, call: ToolCall, card: ApprovalCard) {
  const { deps, run, runId, bot, thread } = ctx;
  const { name, args, executionId, applied } = call;
  if (!(await renewRunLease(deps, runId, ctx.workerId, ctx.fence))) {
    return pauseForApproval(ctx);
  }
  await ctx.computer.checkpoint.flush();
  await persistTurnCheckpoint(ctx, executionId);
  await ctx.settleRunningHelpers();
  const paused = await deps.events.pauseRunForInput({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId,
    attemptId: ctx.attempt.id,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    blocks: [
      buildApprovalAskBlock(
        applied!.effect.id,
        name,
        name === "update_bot" && "previousInstructions" in args ? { ...args, botId: bot.id } : args,
        ctx.secrets,
        card,
      ),
    ],
  });
  if (!paused) {
    throw new Error("Could not pause this run for approval; try sending again.");
  }
  await enqueueSteeringContinuation(deps, paused.continuationRunId);
  await notifyRun(deps, run, {
    kind: "help",
    title: `${displayName(bot.name, "Bot")} needs approval`,
    body: `Review before ${name}`,
    botId: bot.id,
    threadId: thread.id,
  });
  return pauseForApproval(ctx);
}

async function reviewToolCall(
  ctx: RunContext,
  review: ToolReview,
): Promise<{ reason: string | undefined; decision: "ask" | "allow" } | undefined> {
  const { deps, run, runId, bot, thread, context } = ctx;
  const { name, args, connectorKind, fetchUrl, gated, applied } = review;
  const { injectedReview, checker, reviewSettings, memberChecker } = review;
  if (!injectedReview && !checker && !reviewSettings?.backups.length) return;
  try {
    const botDescription = redactSecrets(`${bot.name}\n${bot.description}`, ctx.secrets);
    const outsideRun = run.trigger === "webhook";
    const ownerWords = outsideRun ? await ctx.trust.loadOwnerWords() : "";
    if (outsideRun && !ownerWords.trim()) return { reason: undefined, decision: "ask" };
    const ownerWordsOnly = (review.newSite && fetchUrl) || review.memoryWrite;
    const reviewRequest: AutoReviewRequest = {
      toolName: name,
      connectorKind,
      args:
        review.newSite && fetchUrl
          ? { url: redactSecrets(fetchUrl, ctx.secrets) }
          : redactToolArgsForReview(args, ctx.secrets),
      userTask: redactSecrets(
        outsideRun
          ? ownerWords
          : ownerWordsOnly
            ? await ctx.trust.loadOwnerWords()
            : ctx.task.prompt,
        ctx.secrets,
      ),
      botDescription,
      matchingRules: review.matchingRules,
      ...(review.newSite && fetchUrl ? { newSite: true } : {}),
      ...(review.memoryWrite ? { memoryWrite: true } : {}),
    };
    const reviewContext: AdapterContext = {
      operationId: `auto-review:${runId}`,
      traceId: `auto-review:${runId}`,
      spaceId: run.spaceId,
      userId: run.userId,
      botId: bot.id,
      runId,
      signal: context.signal,
    };
    const checkerProvider = (checker: AutoReviewChecker) =>
      autoReviewCheckerProvider(
        deps,
        {
          runId,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          threadId: thread.id,
        },
        {
          injectedReview,
          memberChecker,
          backups: reviewSettings?.backups,
          registerSecrets: (values) => ctx.secrets.push(...values),
        },
        checker,
      );
    const judge = await reviewWithBackups(
      [
        ...(checker
          ? [checker]
          : injectedReview
            ? [{ provider: "injected", model: "injected" }]
            : []),
        ...(reviewSettings?.backups.map((choice) => ({
          provider: choice.provider,
          model: choice.modelId,
          thinkingLevel: choice.thinkingLevel,
          credentialId: choice.credentialId,
        })) ?? []),
      ],
      async (checker) => {
        const provider = await checkerProvider(checker);
        return provider.review(reviewRequest, reviewContext);
      },
      context.signal,
    );
    if (context.signal.aborted) return;
    const verdict = {
      reason: judge.reason,
      decision: applyJudgeDecision({ decision: judge.decision, consequential: gated }),
    };
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: {
          reviewDecision: judge.decision,
          reviewReason: judge.reason,
          reviewModel: judge.model,
        },
      });
    }
    await auditAutoReview(ctx, name, applied, judge.decision, judge.model);
    return verdict;
  } catch {
    if (context.signal.aborted) return;
    const reviewReason = "Checker could not authenticate.";
    const verdict = {
      reason: reviewReason,
      decision: applyJudgeDecision({ decision: "error", consequential: gated }),
    };
    const reviewModel = checker
      ? `${checker.provider}/${checker.model}`
      : (injectedReview?.describe().id ?? "auto-review");
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: { reviewDecision: "error", reviewReason, reviewModel },
      });
    }
    await auditAutoReview(ctx, name, applied, "error", reviewModel);
    return verdict;
  }
}

function auditAutoReview(
  ctx: RunContext,
  tool: string,
  applied: AppliedEffect | undefined,
  decision: string,
  model: string | undefined,
): Promise<void> {
  return auditToolCall(
    ctx,
    tool,
    decision === "error" ? "failure" : "success",
    { effectId: applied?.effect.id, decision },
    { action: "approval.auto_reviewed", actor: { type: "system", label: model } },
  );
}
