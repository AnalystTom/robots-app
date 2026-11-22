import { ORPCError } from "@orpc/server";
import {
  changeUserTimezone,
  effectiveModelRole,
  hasHostedModelCredits,
  isAutoReviewCheckerConfigured,
  loadUserIncomingCalls,
  PushSessionEndedError,
  settleCallRequest,
} from "@robots/adapters";
import type {
  ActionApprovalRule,
  ActionRule,
  Actor,
  Me,
  SettingsScope,
  SpaceChangeKind,
} from "@robots/contracts";
import { ActionRuleSchema, parseLabs } from "@robots/contracts";
import {
  abortableDelay,
  approvalModeFromPreference,
  approvalPreferenceFromMode,
  callRequestClientNonce,
} from "@robots/core";
import { urlSite } from "@robots/core/egress";
import {
  auditLogOrganization,
  commitBotUpdate,
  findAutoReviewPreference,
  findDefaultVoiceCredential,
  findModelCredential,
  findModelCredentialById,
  isRecordNotFound,
  listActionRules,
  listApprovalRules,
  listAuditEvents,
  listVoicePreferences,
  lockSpaceSettings,
  newestVoiceCredentialOrder,
  Prisma,
  removeApprovalRule,
  runAsSystem,
  runAsTenant,
  saveActionRules,
  saveApprovalRule,
  saveAutoReviewPreference,
  selectVoicePreference,
  voicePreferenceTarget,
  withTransactionRetry,
} from "@robots/db";
import { getLogger } from "@robots/logging";
import { createAccessGrant, listAccessGrants, revokeAccessGrant } from "../access-grants.js";
import { requireAdmin } from "../admins.js";
import { aiConsentStatus, allowAiConsent, revokeAiConsent } from "../ai-consent.js";
import type { BillingService } from "../billing.js";
import { firstModelConnectAnalytics } from "../model-connect-analytics.js";
import type { RouterDeps } from "../router.js";
import {
  accountVoiceCatalog,
  disconnectVoiceCredential,
  loadDefaultVoiceCredential,
  loadVoiceCredential,
  persistVoiceCredential,
  prepareVoice,
  toVoiceCredential,
  toVoiceStatus,
  updateVoiceSpeechModel,
  voiceContext,
  voiceCredentialHasKey,
  voiceCredentialServer,
  voiceProviderFor,
  withVoiceConnection,
} from "../voice.js";
import type { RouterContext } from "./context.js";
import { HEARTBEAT, meDto, mergeStreams, withHeartbeats } from "./shared.js";

const ROSTER_CHANGED = Symbol("roster changed");

const SIGNAL_FAILURE_HOLD_MS = 30_000;

export function accountRoutes(ctx: RouterContext) {
  const { deps, os, authed } = ctx;
  return {
    aiConsent: {
      status: authed.aiConsent.status.handler(({ context, input }) =>
        aiConsentStatus(deps, context.actor, input),
      ),
      allow: authed.aiConsent.allow.handler(({ context, input }) =>
        allowAiConsent(deps, context.actor, input),
      ),
      revoke: authed.aiConsent.revoke.handler(({ context, input }) =>
        revokeAiConsent(deps, context.actor, input.key ?? null),
      ),
    },
    analytics: {
      screen: authed.analytics.screen.handler(async ({ context, input }) => {
        deps.analytics?.capture(
          context.actor.userId,
          { name: "screen_viewed", ...input },
          undefined,
          input.planLayout ? { "plan-layout": input.planLayout } : undefined,
        );
        return { ok: true as const };
      }),
    },
    health: os.health.handler(async () => ({ ok: true as const, version: "0.1.0" })),
    me: authed.me.handler(async ({ context }): Promise<Me> => meDto(deps, context.actor)),
    billing: {
      selectFunding: authed.billing.selectFunding.handler(async ({ context, input }) => {
        const billing = requireBilling(deps);
        if (input.funding === "credits") {
          const record = await firstModelConnectAnalytics(deps, context.actor, "credits");
          record(undefined, { name: "model_connect_started" });
        }
        return billing.selectFunding(
          context.actor,
          input.funding,
          input.client,
          input.interval,
          input.tier,
        );
      }),
      purchaseCredits: authed.billing.purchaseCredits.handler(async ({ context, input }) =>
        requireBilling(deps).purchaseCredits(context.actor, input),
      ),
      setMonthlyCredits: authed.billing.setMonthlyCredits.handler(async ({ context, input }) =>
        requireBilling(deps).setMonthlyCredits(context.actor, input.amountCents),
      ),
      status: authed.billing.status.handler(async ({ context, input }) => {
        const billing = requireBilling(deps);
        if (input?.referralCode) await billing.claimReferral(context.actor, input.referralCode);
        return billing.status(context.actor);
      }),
      refresh: authed.billing.refresh.handler(async ({ context }) => {
        const billing = requireBilling(deps);
        await billing.syncForActor(context.actor);
        return billing.status(context.actor);
      }),
      checkout: authed.billing.checkout.handler(async ({ context, input }) =>
        requireBilling(deps).checkout(context.actor, input?.client, input?.interval, input?.tier),
      ),
      portal: authed.billing.portal.handler(async ({ context, input }) =>
        requireBilling(deps).portal(context.actor, input?.client),
      ),
      endTrial: authed.billing.endTrial.handler(async ({ context }) => {
        const billing = requireBilling(deps);
        await billing.endTrial(context.actor);
        return billing.status(context.actor);
      }),
      switchToYearly: authed.billing.switchToYearly.handler(async ({ context }) => {
        const billing = requireBilling(deps);
        await billing.switchToYearly(context.actor);
        return billing.status(context.actor);
      }),
      changeTier: authed.billing.changeTier.handler(async ({ context, input }) => {
        const billing = requireBilling(deps);
        await billing.changeTier(context.actor, input.tier);
        return billing.status(context.actor);
      }),
      claimReferral: authed.billing.claimReferral.handler(async ({ context, input }) => {
        await requireBilling(deps).claimReferral(context.actor, input.code);
        return { ok: true as const };
      }),
    },
    accessGrants: {
      list: authed.accessGrants.list.handler(async ({ context }) => {
        await requireGrantAdmin(deps, context.actor);
        return listAccessGrants(deps.prisma);
      }),
      create: authed.accessGrants.create.handler(async ({ context, input }) => {
        await requireGrantAdmin(deps, context.actor);
        return createAccessGrant(deps.prisma, context.actor.userId, input);
      }),
      revoke: authed.accessGrants.revoke.handler(async ({ context, input }) => {
        await requireGrantAdmin(deps, context.actor);
        return revokeAccessGrant(deps.prisma, input.id);
      }),
    },
    preferences: {
      update: authed.preferences.update.handler(async ({ context, input }): Promise<Me> => {
        const userId = context.actor.userId;
        const botAvatarSet = input.botAvatarSet;
        const deploymentLabs = deps.env?.deploymentLabs ?? [];
        const labs =
          input.labs === undefined
            ? undefined
            : parseLabs(input.labs).filter((feature) => !deploymentLabs.includes(feature));
        if (input.timezone !== undefined) {
          await changeUserTimezone(deps, userId, input.timezone, {
            ...(input.locale === undefined ? {} : { locale: input.locale }),
            ...(botAvatarSet === undefined ? {} : { botAvatarSet }),
            ...(labs === undefined ? {} : { labs }),
          });
        } else {
          await deps.prisma.user.update({
            where: { id: userId },
            data: {
              ...(input.locale === undefined ? {} : { locale: input.locale }),
              ...(botAvatarSet === undefined ? {} : { botAvatarSet }),
              ...(labs === undefined ? {} : { labs }),
            },
          });
        }
        if (botAvatarSet !== undefined) {
          const bots = await runAsSystem("restyle the user's own bots in all their spaces", () =>
            deps.prisma.bot.findMany({
              where: { userId, avatarSetPinned: false, avatarSet: { not: botAvatarSet } },
              select: { id: true, spaceId: true, thread: { select: { id: true } } },
            }),
          );
          for (const bot of bots) {
            const threadId = bot.thread?.id;
            if (!threadId) continue;
            const current = await deps.prisma.user.findUniqueOrThrow({
              where: { id: userId },
              select: { botAvatarSet: true },
            });
            if (current.botAvatarSet !== botAvatarSet) break;
            await runAsTenant({ spaceId: bot.spaceId, userId }, () =>
              commitBotUpdate({
                prisma: deps.prisma,
                notify: (thread, seq) => deps.events.notify(thread, seq),
                spaceId: bot.spaceId,
                threadId,
                botId: bot.id,
                emitBotUpdated: true,
                expectedSettings: { avatarSetPinned: false },
                expectedUserAvatarSet: { userId, botAvatarSet },
                data: { avatarSet: botAvatarSet },
              }),
            ).catch((error) => {
              if (!isRecordNotFound(error)) getLogger().error("bot style restyle", error);
            });
          }
        }
        return meDto(deps, context.actor);
      }),
      adoptTimezone: authed.preferences.adoptTimezone.handler(
        async ({ context, input }): Promise<Me> => {
          await deps.prisma.user.updateMany({
            where: { id: context.actor.userId, timezone: null },
            data: { timezone: input.timezone },
          });
          return meDto(deps, context.actor);
        },
      ),
    },
    deployment: {
      get: authed.deployment.get.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
      update: authed.deployment.update.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
    },
    security: {
      events: authed.security.events.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
    },
    audit: {
      events: authed.audit.events.handler(async ({ context, input }) => {
        const organizationId = await auditLogOrganization(deps.prisma, context.actor);
        if (!organizationId) throw new ORPCError("FORBIDDEN");
        return runAsSystem("read the organization's audit log", () =>
          listAuditEvents(deps.prisma, organizationId, input),
        );
      }),
    },
    updater: {
      status: authed.updater.status.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
      check: authed.updater.check.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
      apply: authed.updater.apply.handler(() => {
        throw new ORPCError("FORBIDDEN");
      }),
    },
    approvalRules: {
      list: authed.approvalRules.list.handler(async ({ context, input }) => {
        const rows = await listApprovalRules(deps.prisma, context.actor, input?.scope);
        return rows.map(approvalRuleDto);
      }),
      set: authed.approvalRules.set.handler(async ({ context, input }) => {
        const { scope, ...rule } = input;
        return approvalRuleDto(
          await deps.prisma.$transaction((tx) => saveApprovalRule(tx, context.actor, rule, scope)),
        );
      }),
      remove: authed.approvalRules.remove.handler(async ({ context, input }) => {
        await deps.prisma.$transaction((tx) =>
          removeApprovalRule(tx, context.actor, input.id, input.scope),
        );
        return { ok: true as const };
      }),
    },
    actionRules: {
      list: authed.actionRules.list.handler(async ({ context, input }) =>
        storedActionRules(await listActionRules(deps.prisma, context.actor, input?.scope)),
      ),
      set: authed.actionRules.set.handler(async ({ context, input }) => {
        await deps.prisma.$transaction((tx) =>
          saveActionRules(tx, context.actor, input.rules, input.scope),
        );
        return input.rules;
      }),
    },
    trustedLinkSites: {
      list: authed.trustedLinkSites.list.handler(async ({ context }) => {
        const rows = await deps.prisma.trustedLinkSite.findMany({
          where: { userId: context.actor.userId },
          orderBy: { site: "asc" },
        });
        return rows.map((row) => row.site);
      }),
      trust: authed.trustedLinkSites.trust.handler(async ({ context, input }) => {
        const site = urlSite(input.url);
        if (!site) throw new ORPCError("BAD_REQUEST", { message: "Not a web link." });
        await deps.prisma.trustedLinkSite.createMany({
          data: { userId: context.actor.userId, site },
          skipDuplicates: true,
        });
        return { site };
      }),
      remove: authed.trustedLinkSites.remove.handler(async ({ context, input }) => {
        await deps.prisma.trustedLinkSite.deleteMany({
          where: { userId: context.actor.userId, site: input.site },
        });
        return { ok: true as const };
      }),
    },
    autoReview: {
      get: authed.autoReview.get.handler(async ({ context, input }) => {
        return loadAutoReviewSettings(deps, context.actor, input?.scope);
      }),
      set: authed.autoReview.set.handler(async ({ context, input }) => {
        await deps.prisma.$transaction((tx) =>
          saveAutoReviewPreference(
            tx,
            context.actor,
            input.mode
              ? approvalPreferenceFromMode(input.mode)
              : { enabled: input.enabled, skipApprovals: input.skipApprovals },
            { enabled: true, skipApprovals: false },
            input.scope,
          ),
        );
        return loadAutoReviewSettings(deps, context.actor, input.scope);
      }),
    },
    notifications: {
      subscribe: authed.notifications.subscribe.handler(async function* ({ context }) {
        const { followChatAlerts, followRosterChanges, followSpaceChanges } = deps.events;
        if (!followChatAlerts) throw new ORPCError("NOT_FOUND");
        const { spaceId, userId } = context.actor;
        const rosterChanges = async function* (
          signal: AbortSignal,
        ): AsyncGenerator<typeof ROSTER_CHANGED> {
          if (!followRosterChanges) return;
          try {
            for await (const _ of followRosterChanges(userId, signal)) yield ROSTER_CHANGED;
          } catch (error) {
            await abortableDelay(SIGNAL_FAILURE_HOLD_MS, signal);
            throw error;
          }
        };
        const spaceChanges = async function* (
          signal: AbortSignal,
        ): AsyncGenerator<{ spaceChange: SpaceChangeKind }> {
          if (!followSpaceChanges) return;
          try {
            for await (const spaceChange of followSpaceChanges(spaceId, signal))
              yield { spaceChange };
          } catch (error) {
            await abortableDelay(SIGNAL_FAILURE_HOLD_MS, signal);
            throw error;
          }
        };
        const frames = withHeartbeats(context, (signal) =>
          mergeStreams(
            followChatAlerts(userId, spaceId, signal),
            rosterChanges(signal),
            spaceChanges(signal),
          ),
        );
        for await (const next of frames) {
          if (next === HEARTBEAT) yield { type: "heartbeat" as const };
          else if (next === ROSTER_CHANGED) yield { type: "roster" as const };
          else if ("spaceChange" in next) yield { type: next.spaceChange };
          else if (next.spaceId === spaceId) yield { type: "alert" as const, alert: next };
        }
      }),
      subscribeCalls: authed.notifications.subscribeCalls.handler(async function* ({ context }) {
        const { followIncomingCalls } = deps.events;
        if (!deps.env?.phoneCallsEnabled || !followIncomingCalls) throw new ORPCError("NOT_FOUND");
        const { userId } = context.actor;
        const signals = withHeartbeats(context, (signal) => followIncomingCalls(userId, signal));
        for await (const next of signals) {
          yield next === HEARTBEAT
            ? { type: "heartbeat" as const }
            : {
                type: "incoming.calls" as const,
                payload: { calls: await loadUserIncomingCalls(deps.prisma, userId) },
              };
        }
      }),
      declineIncomingCall: authed.notifications.declineIncomingCall.handler(
        async ({ context, input }) => {
          if (!deps.env?.phoneCallsEnabled) throw new ORPCError("NOT_FOUND");
          const settled = await runAsSystem(
            "decline the signed-in call owner's incoming call",
            async () => {
              const message = await deps.prisma.message.findFirst({
                where: {
                  clientNonce: callRequestClientNonce(input.callId),
                  role: "bot",
                  thread: {
                    userId: context.actor.userId,
                    groupId: null,
                    bot: { userId: context.actor.userId },
                  },
                },
                select: { threadId: true },
              });
              if (!message) throw new ORPCError("NOT_FOUND");
              return settleCallRequest(deps, {
                threadId: message.threadId,
                callId: input.callId,
                from: ["ringing"],
                status: "declined",
              });
            },
          );
          if (settled?.status !== "declined") throw new ORPCError("CONFLICT");
          return { ok: true as const };
        },
      ),
      registerCallPush: authed.notifications.registerCallPush.handler(
        async ({ context, input }) => {
          if (!context.sessionId) throw new ORPCError("UNAUTHORIZED");
          try {
            await deps.pushTokens.saveDevice?.(context.actor.userId, input, context.sessionId);
          } catch (error) {
            if (error instanceof PushSessionEndedError) throw new ORPCError("UNAUTHORIZED");
            throw error;
          }
          return { ok: true as const };
        },
      ),
      registerPush: authed.notifications.registerPush.handler(async ({ context, input }) => {
        const sessionId = context.sessionId;
        if (!sessionId) throw new ORPCError("UNAUTHORIZED");
        try {
          await deps.pushTokens.save(
            context.actor.userId,
            input.token,
            sessionId,
            input.presentation,
          );
        } catch (error) {
          if (error instanceof PushSessionEndedError) throw new ORPCError("UNAUTHORIZED");
          throw error;
        }
        return { ok: true as const };
      }),
      unregisterPush: authed.notifications.unregisterPush.handler(async ({ context }) => {
        if (context.sessionId) {
          await deps.pushTokens.endSession(context.actor.userId, context.sessionId);
          return { ok: true as const };
        }
        await deps.pushTokens.remove(context.actor.userId);
        return { ok: true as const };
      }),
      followWorkActivity: authed.notifications.followWorkActivity.handler(
        async ({ context, input }) => {
          if (!context.sessionId) throw new ORPCError("UNAUTHORIZED");
          if (!input.token) return { following: Boolean(deps.workActivities) };
          const following = await deps.workActivities?.register(
            context.actor.userId,
            context.sessionId,
            input.token,
          );
          return { following: following ?? false };
        },
      ),
      registerWorkActivityStarts: authed.notifications.registerWorkActivityStarts.handler(
        async ({ context, input }) => {
          if (!context.sessionId) throw new ORPCError("UNAUTHORIZED");
          await deps.workActivities?.registerStarts(
            context.actor.userId,
            context.sessionId,
            input.token,
          );
          return { ok: true as const };
        },
      ),
    },
    voice: {
      catalog: authed.voice.catalog.handler(async ({ context }) =>
        accountVoiceCatalog(deps, context.actor),
      ),
      status: authed.voice.status.handler(async ({ context, input }) => {
        const cred = await findDefaultVoiceCredential(deps.prisma, context.actor, input?.scope);
        return toVoiceStatus(cred);
      }),
      credentials: authed.voice.credentials.handler(async ({ context, input }) => {
        const target = await voicePreferenceTarget(deps.prisma, context.actor, input?.scope);
        const [rows, preferences] = await Promise.all([
          deps.prisma.userVoiceCredential.findMany({
            where: { userId: context.actor.userId },
            orderBy: newestVoiceCredentialOrder,
          }),
          listVoicePreferences(deps.prisma, target),
        ]);
        return Promise.all(
          rows.map(async (row) => {
            const preference = preferences.find((saved) => saved.credentialId === row.id);
            return toVoiceCredential({
              ...row,
              isDefault: preference?.isDefault ?? false,
              voiceId: preference?.voiceId ?? "",
              speechModel: preference?.speechModel ?? "",
              server: await voiceCredentialServer(deps, context.actor, row),
              hasKey: await voiceCredentialHasKey(deps, context.actor, row),
            });
          }),
        );
      }),
      connect: authed.voice.connect.handler(async ({ context, input }) =>
        persistVoiceCredential(deps, context.actor, {
          provider: input.provider,
          plaintext: input.apiKey,
          voiceId: input.voiceId,
          speechModel: input.speechModel,
          baseUrl: input.baseUrl,
          sttBaseUrl: input.sttBaseUrl,
          sttApiKey: input.sttApiKey,
          ttsModel: input.ttsModel,
          sttModel: input.sttModel,
          scope: input.scope,
          signal: context.signal,
        }),
      ),
      disconnect: authed.voice.disconnect.handler(async ({ context, input }) =>
        disconnectVoiceCredential(deps, context.actor, { provider: input.provider }),
      ),
      setVoice: authed.voice.setVoice.handler(async ({ context, input }) => {
        const cred = await withTransactionRetry(() =>
          deps.prisma.$transaction(
            async (tx) => {
              await lockSpaceSettings(tx, context.actor);
              const target = await voicePreferenceTarget(tx, context.actor, input.scope);
              const found = input.provider
                ? await tx.userVoiceCredential.findFirst({
                    where: { userId: context.actor.userId, provider: input.provider },
                    orderBy: newestVoiceCredentialOrder,
                  })
                : await findDefaultVoiceCredential(tx, context.actor, target.scope);
              if (!found) {
                throw new ORPCError("BAD_REQUEST", { message: "Connect a voice provider first." });
              }
              await selectVoicePreference(tx, target, found.id, input.voiceId);
              return { ...found, voiceId: input.voiceId, isDefault: true };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        );
        return toVoiceStatus(cred);
      }),
      setSpeechModel: authed.voice.setSpeechModel.handler(async ({ context, input }) =>
        updateVoiceSpeechModel(deps, context.actor, input),
      ),
      voices: authed.voice.voices.handler(async ({ context, input }) => {
        const row = input.provider
          ? await loadVoiceCredential(
              deps,
              context.actor,
              input.provider,
              input.scope,
              context.signal,
            )
          : await loadDefaultVoiceCredential(deps, context.actor, input.scope, context.signal);
        if (!row) return [];
        const provider = await voiceProviderFor(deps, row.cred.provider);
        return withVoiceConnection(row.cred.provider, row.linked, () =>
          provider.listVoices(row.apiKey, voiceContext(context.actor, context.signal), {
            language: input.language,
          }),
        );
      }),
      prepare: authed.voice.prepare.handler(async ({ context, input }) =>
        prepareVoice(deps, context.actor, { ...input, signal: context.signal }),
      ),
    },
  };
}

function approvalRuleDto(row: {
  id: string;
  effect: string;
  matchKind: string;
  matchValue: string;
  createdAt: Date;
}): ActionApprovalRule {
  return {
    id: row.id,
    effect: row.effect as ActionApprovalRule["effect"],
    matchKind: row.matchKind as ActionApprovalRule["matchKind"],
    matchValue: row.matchValue,
    createdAt: row.createdAt.toISOString(),
  };
}

function storedActionRules(stored: unknown[]): ActionRule[] {
  return stored.flatMap((rule) => {
    const parsed = ActionRuleSchema.safeParse(rule);
    return parsed.success ? [parsed.data] : [];
  });
}

async function loadAutoReviewSettings(deps: RouterDeps, actor: Actor, scope?: SettingsScope) {
  const [role, preference] = await Promise.all([
    effectiveModelRole(
      deps.prisma,
      actor,
      "approval",
      { env: process.env },
      scope === "account" ? "account" : undefined,
    ),
    findAutoReviewPreference(deps.prisma, actor, scope),
  ]);
  const stored = {
    enabled: preference?.enabled ?? true,
    skipApprovals: preference?.skipApprovals ?? false,
  };
  const settings = { ...stored, mode: approvalModeFromPreference(stored) };
  const deploymentChecker = role.primarySource === "deployment" ? role.primary : null;
  const memberChoices = [
    ...(deploymentChecker || !role.primary ? [] : [role.primary]),
    ...role.backups,
  ];
  const environmentAvailable = isAutoReviewCheckerConfigured({ env: process.env });
  if (memberChoices.length === 0) {
    const requiredUserProvider =
      environmentAvailable || deploymentChecker?.provider === "scripted"
        ? null
        : deploymentChecker?.provider;
    const credential = requiredUserProvider
      ? await deps.prisma.userModelCredential.findFirst({
          where: { userId: actor.userId, provider: requiredUserProvider },
          select: { id: true },
        })
      : null;
    return { ...settings, checkerAvailable: environmentAvailable || Boolean(credential) };
  }
  const connections = await Promise.all(
    memberChoices.map((choice) =>
      choice.credentialId
        ? findModelCredentialById(deps.prisma, actor, choice.credentialId)
        : findModelCredential(deps.prisma, actor, choice.provider, choice.modelId),
    ),
  );
  const checkerAvailable =
    connections.some(Boolean) ||
    (deploymentChecker !== null && environmentAvailable) ||
    (
      await Promise.all(
        [...new Set(memberChoices.map((choice) => choice.provider))].map((provider) =>
          hasHostedModelCredits(deps.prisma, actor, provider),
        ),
      )
    ).some(Boolean);
  return { ...settings, checkerAvailable };
}

function requireBilling(deps: RouterDeps): BillingService {
  if (!deps.billing) throw new ORPCError("NOT_FOUND", { message: "Billing is not enabled" });
  return deps.billing;
}

async function requireGrantAdmin(deps: RouterDeps, actor: Actor) {
  await requireAdmin(deps, actor.userId);
  if (!deps.billing?.modelCreditsEnabled)
    throw new ORPCError("NOT_FOUND", { message: "Model credits are not enabled" });
}
