import type { AgentRunRequest, ComputerRef, SemanticMemoryProvider } from "@robots/adapter-kit";
import { DEFAULT_CONTEXT_STRATEGY } from "@robots/adapter-kit";
import type { MessageBlock, RunStatus } from "@robots/contracts";
import { disabledBuiltinToolSet, hasLab, isMacAppTool, resolveLabs } from "@robots/contracts";
import {
  BACKGROUND_HELPER_TRIGGER,
  botMessageAllowsSilence,
  expandSkillReferencesInPrompt,
  formatSkillRunPrompt,
  formatSkillsCatalogInstruction,
  isCallClientNonce,
  isMessagingChannelRun,
  isOwnerStartedRun,
  isTerminal,
  messagingChannelId,
  messagingChannelPrivacyBlock,
  messagingDmSurfaceNote,
  nonOwnerChatPrivacyBlock,
  promptInvokesSkill,
  redactSecrets,
  renderBotDirectory,
  userTurnMessageForRun,
} from "@robots/core";
import type { ThreadEvents } from "@robots/db";
import {
  accountDeactivated,
  appendEventInTransaction,
  availableInSpace,
  cancelDeactivatedAccountRuns,
  cancelRunsInTransaction,
  createPendingSteeringRun,
  databaseOutage,
  effectiveMemoryScope,
  isDatabaseUnavailable,
  isPartialReplyClientNonce,
  loadRunHistoryMessages,
  loadRunTurnCheckpoint,
  parseComputerMode,
  RunHistoryWriteError,
  readRunTimingFields,
  recordUsage,
  retryWhileDatabaseUnavailable,
  settleReleasedTakeoverCards,
  teamChatRunFromOwner,
} from "@robots/db";
import { bestEffort, enrichLogContext, getLogger } from "@robots/logging";
import { formatAgentEnvironmentInstruction } from "./agent-environment.prompt.js";
import { createApprovedEffectReplayQueue } from "./approval-effect.js";
import { PARTIAL_REPLY_NOTE } from "./automated-messages.prompt.js";
import { backgroundHelpersAllowed } from "./background-helpers.js";
import { loadBotMessageContext } from "./bot-messages.js";
import {
  loadCommandVariables,
  loadLoginPasswordRedactions,
  loadRunCodeRedactions,
  loadRunLoginRedactions,
} from "./bot-secrets.js";
import { createBrowserProvider } from "./browser-provider-factory.js";
import { agentConnectionTools, builtinAgentTools } from "./builtin.tool-definition.js";
import { partitionTools } from "./builtin-tool-bridge.js";
import { USER_CLOUD_AGENT_KEY_PREFIX } from "./cloud-agent-factory.js";
import { cloudAgentForActor } from "./cloud-agent-service.js";
import { mergeConnectedPlugins, needsLivePluginSync } from "./composio-connector.js";
import { diskNoteInstruction, recordComputerDisk } from "./computer-disk.js";
import { scheduleComputerSleep } from "./computer-idle.js";
import type { ComputerExecutionLease } from "./computer-lifecycle.js";
import {
  acquireComputerExecutionLease,
  acquireDedicatedScreenLeaseFence,
  ComputerBusyError,
  EXECUTION_LEASE_MS,
  provisionComputer,
  releaseComputerExecutionLease,
  renewComputerExecutionLease,
  screenLeaseIdForRun,
} from "./computer-lifecycle.js";
import {
  computerCheckpointResolver,
  isLostPinnedModel,
  PINNED_COMPUTER_MODEL_LOST_RUN_ERROR,
  resolveComputerRunModel,
} from "./computer-model-settings.js";
import { teamWorkspaceInstruction } from "./computer-support.prompt.js";
import { checkpointRunComputerWorkspace } from "./computer-workspace.js";
import {
  connectedContext,
  loadLivePluginSlugs,
  persistLivePluginConnections,
  selectRunConnections,
} from "./connection-context.js";
import { formatCurrentTimeInstruction } from "./current-time.prompt.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import type { ExecutorDeps } from "./executor-deps.js";
import type { FleetRun } from "./fleet-tools.js";
import { loadBotGroupDirectory, loadGroupContext } from "./group-handoff.js";
import {
  historyWindowSize,
  LEGACY_HISTORY_WINDOW_SIZE,
  selectCompactedHistory,
} from "./history-compaction.js";
import {
  formatCompactedSummary,
  formatRecalledMemory,
  MAX_RECALLED_MEMORIES,
} from "./history-compaction.prompt.js";
import {
  historySpeaker,
  loadSpacePeople,
  loadThreadSpeakers,
  neutralizeSpeakerLabels,
  personSpeaker,
} from "./history-speakers.js";
import { createMediaGenerationProvider } from "./media-generation-factory.js";
import { loadAgentMemoryContext } from "./memory-context.js";
import { resolveMemberMainModel, selectConfiguredModel } from "./model-roles.js";
import {
  findConnectedModelCredential,
  PINNED_PROVIDER_NOT_CONNECTED,
  pinnedModelCredentialError,
  runModelChoice,
} from "./model-selection.js";
import { modelAcceptsImageInput } from "./model-vision.js";
import { createPaidServiceProvider } from "./paid-services-factory.js";
import { paymentWalletConnected } from "./payment-wallets.js";
import { restoreComputerModels } from "./pi-runtime-computer-mode.js";
import { promptVersion } from "./prompt-version.js";
import { loadPurchaseRedactions } from "./purchase-service.js";
import {
  loadReplyContext,
  messageToAgentHistorySegments,
  messageToAgentHistoryText,
} from "./reply-context.js";
import { backOffRoutineAfterAccountError } from "./routine-backoff.js";
import { lateRoutineRunDueAt } from "./routine-lateness.js";
import { lateRoutineRunInstruction } from "./routine-lateness.prompt.js";
import { lazyRunComputer } from "./run-computer.js";
import type {
  RunComputerUseState,
  RunContext,
  RunLeaseState,
  RunningHelper,
  RunState,
} from "./run-context.js";
import { restoreTurnCheckpointEffects, settleRunningHelpers } from "./run-context.js";
import { APPROVED_EFFECT_REPLAY_ORDER, buildApprovalContinuation } from "./run-effects.js";
import {
  BOT_DIRECTORY_LIMIT,
  botEmailInstruction,
  COMPUTER_USE_INSTRUCTION,
  dockerComputerToolInstruction,
  hostComputerInstruction,
  PRIVATE_WORKSPACE_INSTRUCTION,
  persistentComputerInstruction,
  runIdentityInstruction,
  threadContextForRun,
  userTurnInstructions,
  voiceCallInstruction,
} from "./run-instructions.prompt.js";
import {
  claimRun,
  createRunWorkspaceCheckpoint,
  failRunBeforeTurn,
  finishRunAttempt,
  mayOpenModelStream,
  renewRunLease,
  requeueComputerRun,
  retryRunSetup,
  runEndedForThisWorker,
} from "./run-lifecycle.js";
import { withRunLease } from "./run-messages.js";
import {
  modelCreditBillingEnabled,
  resolveConnectedRunModel,
  resolvedModelRunFields,
  resolveRunModel,
  runtimeFallbackModel,
} from "./run-model.js";
import { runModelBackups, startRunModel } from "./run-model-start.js";
import { createReplyState } from "./run-progress.js";
import {
  DELEGATED_EMPTY_NOTICE,
  GROUP_UNADDRESSED_REPLY_GUIDANCE,
  runAllowsSilentEmpty,
  runReplyGuidance,
  runReplyMode,
} from "./run-replies.prompt.js";
import {
  notifyRoutineRetryAttemptsExhausted,
  retryRoutineRun,
  wakeRoutine,
} from "./run-routines.js";
import {
  BUILTIN_AGENT_TOOL_NAMES,
  followUpsOffered,
  offeredFleetTools,
  offersAgentConnectionTools,
  selectBuiltinToolsForRun,
} from "./run-tool-selection.js";
import { applyTool } from "./run-tools.js";
import { historyMyChatsAllowed } from "./run-tools-memory.js";
import type { UserComputerState } from "./run-tools-user-computer.js";
import { USER_COMPUTER_SHELL_TOOL, userComputerOwner } from "./run-tools-user-computer.js";
import { createRunTrustLoaders } from "./run-trust.js";
import {
  completeRun,
  consumeRunEvents,
  failRun,
  handoffEndedTurn,
  requeueRunAfterDatabaseOutage,
} from "./run-turn.js";
import {
  claimRunSteering,
  loadCurrentTurnImages,
  RECENT_TURN_IMAGE_TURNS,
  withLatestStepScreenshot,
  withRecentTurnImages,
} from "./run-turn-images.js";
import { missingTurnImagesInstruction } from "./run-turn-images.prompt.js";
import { sandboxKindCapabilities } from "./sandbox-kind-capabilities.js";
import { loadAgentScratchpadContext } from "./scratchpad-context.js";
import { inferScript } from "./scripted-runtime.js";
import { loadSharedSpaceNote } from "./shared-space-note.js";
import { builtinAgentSkillRecords, listAgentSkillRecords } from "./skill-tools.js";
import {
  filterStrategicInitiativeTools,
  isStrategicInitiativeRun,
} from "./strategic-initiative.js";
import {
  refreshTakeoverContinuePlan,
  takeoverCheckpointOf,
  takeoverContinuePlan,
} from "./takeover-resume.js";
import { TASK_CATALOG_GUIDANCE } from "./task-catalog.prompt.js";
import { parsePlaybook } from "./teaching-session.js";
import {
  createEarlierFileQueue,
  listCurrentTurnFiles,
  listRecentThreadFiles,
  materializeCurrentTurnFiles,
  materializeEarlierFiles,
  materializeRecentThreadFiles,
} from "./thread-artifacts.js";
import {
  currentTurnFilesInstruction,
  recentThreadFilesInstruction,
} from "./thread-artifacts.prompt.js";
import { loadAgentTicketContext } from "./ticket-context.js";
import { appendToolCompletionAudit, toolCompletionOutcome } from "./tool-completion-audit.js";
import { toolResultFingerprint } from "./tool-loop.js";
import {
  historyReplaysOutsideContent,
  keepToolStepResult,
  runReplaysToolHistory,
} from "./tool-step-calls.js";
import { restoreTurnCheckpoint } from "./turn-checkpoint.js";
import { wakeRun } from "./wake-run.js";
import { createWebProvider } from "./web-provider-factory.js";

async function verbatimMcpServersForRun(
  prisma: ExecutorDeps["prisma"],
  scope: { botId: string; spaceId: string; userId: string },
) {
  if (!prisma.mcpServer?.findMany) return undefined;
  const servers = await prisma.mcpServer.findMany({
    where: {
      verbatimResults: true,
      enabled: true,
      ...availableInSpace(scope),
      AND: [{ OR: [{ allBots: true }, { assignments: { some: { botId: scope.botId } } }] }],
    },
    select: { id: true, slug: true },
  });
  if (!servers?.length) return undefined;
  return { ids: servers.map((server) => server.id), slugs: servers.map((server) => server.slug) };
}

const RUN_HEARTBEAT_MS = 60_000;
const lastKnownHostScreen = new Map<string, boolean>();

function hostGraphical(computerId: string, userId: string, screen: boolean | undefined) {
  const key = JSON.stringify([computerId, userId]);
  if (screen !== undefined) {
    lastKnownHostScreen.set(key, screen);
    return screen;
  }
  const known = lastKnownHostScreen.get(key);
  if (known === undefined) return false;
  getLogger().warn("host screen state unknown; using last known state", { computerId });
  return known;
}

export function createRunExecutor(executorDeps: ExecutorDeps) {
  const contextStrategy = executorDeps.contextStrategy ?? DEFAULT_CONTEXT_STRATEGY;
  const web = executorDeps.web ?? createWebProvider();
  const mediaGeneration = executorDeps.mediaGeneration ?? createMediaGenerationProvider();
  const paidServices = executorDeps.paidServices ?? createPaidServiceProvider();
  const browser =
    executorDeps.browser ?? createBrowserProvider(undefined, { sandbox: executorDeps.sandbox });
  const resolveConnectedModel = resolveConnectedRunModel.bind(undefined, executorDeps);

  const endRunConnectorState = (runId: string) => executorDeps.connector?.endRun?.(runId);
  const events: ThreadEvents = {
    ...executorDeps.events,
    finalizeRun: async (input) => {
      const result = await retryWhileDatabaseUnavailable(
        () => executorDeps.events.finalizeRun(input),
        { source: "run finalize", signal: executorDeps.shutdownSignal },
      );
      if (result || (await runEndedForThisWorker(executorDeps.prisma, input))) {
        endRunConnectorState(input.runId);
      }
      return result;
    },
  };
  const baseDeps: ExecutorDeps = { ...executorDeps, events };
  return {
    resolveConnectedModel,
    contextStrategy,
    resolveModel: resolveRunModel.bind(undefined, baseDeps),
    wakeRoutine: wakeRoutine.bind(undefined, baseDeps),
    notifyRoutineRetryAttemptsExhausted: notifyRoutineRetryAttemptsExhausted.bind(
      undefined,
      baseDeps,
    ),
    retryRoutineRun: retryRoutineRun.bind(undefined, baseDeps),

    async continueRun(runId: string, workerId: string, onRunStarted?: () => void) {
      let deps = baseDeps;
      if (deps.shutdownSignal?.aborted) return;
      const run = await deps.prisma.run.findUnique({
        where: { id: runId },
        include: { routine: { select: { name: true } } },
      });
      if (!run) return;
      enrichLogContext({
        "run.id": runId,
        "bot.id": run.botId,
        "thread.id": run.threadId,
        "space.id": run.spaceId,
        ...(run.userId ? { "user.id": run.userId } : {}),
      });
      if (isTerminal(run.status as RunStatus)) {
        endRunConnectorState(runId);
        return;
      }
      if (await accountDeactivated(deps.prisma, run.userId)) {
        if (await cancelDeactivatedAccountRuns(deps.prisma, deps.events, run.userId, runId)) return;
      }
      if (await cancelRunOfFormerMember(deps, run)) return;
      let { resumeCheckpoint, heldForTakeover, takeoverResume } = takeoverContinuePlan(run);

      const claimed = await claimRun(deps, run, workerId);
      if (!claimed) return;
      await deps.events.publishSpaceChange?.(run.spaceId, "runs");
      const { fence, current } = claimed;
      const leaseTarget = await deps.prisma.bot.findUniqueOrThrow({
        where: { id: run.botId },
        select: {
          computerId: true,
          computerSwitching: true,
          computer: { select: { scope: true } },
        },
      });
      if (!leaseTarget.computerId) throw new Error("Bot has no computer");
      const backgroundHelper = run.trigger === BACKGROUND_HELPER_TRIGGER;
      if (leaseTarget.computerSwitching && !backgroundHelper) {
        await requeueComputerRun(deps, runId, workerId, fence, resumeCheckpoint, heldForTakeover);
        return;
      }
      if (takeoverResume) {
        try {
          await settleReleasedTakeoverCards(
            deps.prisma,
            {
              spaceId: run.spaceId,
              threadId: run.threadId,
              botId: run.botId,
              runId,
              reason: takeoverResume.checkpoint,
              lease: { owner: workerId, fence },
            },
            (threadId, seq) => deps.events.notify(threadId, seq),
          );
        } catch (error) {
          if (error instanceof RunHistoryWriteError) return;
          throw error;
        }
      }
      let computerLease: ComputerExecutionLease | null = null;
      try {
        computerLease = backgroundHelper
          ? null
          : await acquireComputerExecutionLease(deps.prisma, {
              computerId: leaseTarget.computerId,
              runId,
              botId: run.botId,
              workerId,
              runFence: fence,
            });
        if (!computerLease && !backgroundHelper && leaseTarget.computer?.scope === "dedicated") {
          computerLease = await acquireDedicatedScreenLeaseFence(deps.prisma, {
            computerId: leaseTarget.computerId,
            runId,
            botId: run.botId,
            workerId,
            runFence: fence,
          });
        }
      } catch (error) {
        if (!(error instanceof ComputerBusyError)) throw error;
        const heldByAnotherRun = await deps.prisma.computerExecutionLease.findFirst({
          where: {
            computerId: leaseTarget.computerId,
            botId: run.botId,
            runId: { not: runId },
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        await requeueComputerRun(
          deps,
          runId,
          workerId,
          fence,
          resumeCheckpoint,
          heldForTakeover,
          Boolean(heldByAnotherRun),
        );
        return;
      }
      let attempt: { id: string };
      const executionStartedAt = current.startedAt ?? new Date();
      let firstLateSince: Date | undefined;
      if (!current.startedAt && run.trigger === "routine" && run.routineId && run.clientNonce) {
        try {
          const routine = await deps.prisma.routine.findUnique({
            where: { id: run.routineId },
            select: { crons: true, timezone: true },
          });
          if (routine) firstLateSince = lateRoutineRunDueAt(run, routine, executionStartedAt);
        } catch {}
      }
      try {
        const executionStarted = await deps.prisma.run.updateMany({
          where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
          data: { startedAt: executionStartedAt, lateSince: firstLateSince },
        });
        if (executionStarted.count !== 1) {
          await releaseComputerExecutionLease(deps.prisma, computerLease).catch(() => undefined);
          return;
        }
        getLogger().info("run.execution_started", {
          ...(await readRunTimingFields(deps.prisma, runId)),
        });
        attempt = await deps.prisma.attempt.create({
          data: { runId, fence, status: "running" },
        });
      } catch (error) {
        await releaseComputerExecutionLease(deps.prisma, computerLease).catch(() => undefined);
        throw error;
      }

      deps = withRunLease(deps, runId, { owner: workerId, fence });
      const lease: RunLeaseState = {
        valid: true,
        completed: false,
        lastCheckAt: 0,
        retainComputer: false,
        renewedAt: Date.now(),
        handedBack: false,
      };
      const computerUse: RunComputerUseState = {
        reason: "none",
        tool: undefined,
        screenRelease: undefined,
      };
      let runAbortController: AbortController | null = null;
      const runningHelpers = new Map<string, RunningHelper>();
      const settleHelpers = () => settleRunningHelpers(deps, run, runningHelpers);

      let detachShutdown: (() => void) | undefined;
      const heartbeat = setInterval(() => {
        if (lease.completed) return;
        void Promise.all([
          renewRunLease(deps, runId, workerId, fence),
          renewComputerExecutionLease(deps.prisma, computerLease),
        ])
          .then(([runRenewed, computerRenewed]) => {
            if (lease.completed) return;
            if (runRenewed && computerRenewed) {
              lease.renewedAt = Date.now();
              return;
            }
            lease.valid = false;
            runAbortController?.abort();
          })
          .catch((error) => {
            if (lease.completed) return;
            if (
              databaseOutage.failed(error, "run lease renewal") &&
              Date.now() < lease.renewedAt + EXECUTION_LEASE_MS - RUN_HEARTBEAT_MS
            )
              return;
            lease.valid = false;
            runAbortController?.abort();
          });
      }, RUN_HEARTBEAT_MS);
      heartbeat.unref?.();
      const stopHeartbeatAfterCompletion = () => {
        lease.completed = true;
        clearInterval(heartbeat);
      };

      const runSecrets = [...deps.secrets];
      let dispatchHandedOff = false;
      try {
        onRunStarted?.();
        dispatchHandedOff = Boolean(onRunStarted);
        let turnCheckpoint: string | undefined;
        let checkpointLoadError: Error | undefined;
        try {
          turnCheckpoint = await loadRunTurnCheckpoint(deps.prisma, run);
        } catch (error) {
          checkpointLoadError =
            error instanceof Error ? error : new Error("Unsupported turn checkpoint");
        }
        const storedTurnCheckpoint = Boolean(turnCheckpoint);
        const resolveCheckpointModel = (
          provider: string,
          id: string,
          connectionId?: string,
          effort?: string,
        ) =>
          resolveConnectedModel(
            run,
            provider,
            id,
            (values) => runSecrets.push(...values),
            true,
            effort ?? null,
            connectionId,
          );
        const checkpointIdentity = { provider: run.modelProvider ?? "", id: run.modelId ?? "" };
        const checkpointModelResolver = computerCheckpointResolver(
          turnCheckpoint,
          checkpointIdentity,
          resolveCheckpointModel,
        );
        const savedComputerMode = checkpointModelResolver
          ? restoreTurnCheckpoint(turnCheckpoint!, checkpointIdentity).computerMode
          : undefined;
        let pinnedComputerModels: Awaited<ReturnType<typeof restoreComputerModels>> | undefined;
        let pinnedComputerFailure: string | undefined;
        if (savedComputerMode) {
          try {
            pinnedComputerModels = await restoreComputerModels(
              { resolveFallbackModel: checkpointModelResolver },
              savedComputerMode,
            );
          } catch (error) {
            if (!isLostPinnedModel(error)) throw error;
            pinnedComputerFailure = PINNED_COMPUTER_MODEL_LOST_RUN_ERROR;
          }
        }
        const messagingSource =
          run.trigger === "messaging" && run.sourceMessageId
            ? await deps.prisma.message.findUnique({
                where: { id: run.sourceMessageId },
                select: { blocks: true, clientNonce: true },
              })
            : null;
        const sourceBlocks = messagingSource?.blocks as MessageBlock[] | undefined;
        const channelId = messagingChannelId(sourceBlocks);
        const messagingChannelRun = isMessagingChannelRun(run.trigger, sourceBlocks);
        const [
          { bot, ownerLabs },
          thread,
          messages,
          peerMessage,
          task,
          storedConnections,
          main,
          settings,
          configuredMemory,
          savedSkills,
          agentSkills,
          { env: initialBotCommandEnvironment, redactions: commandRedactions },
          savedLoginPasswordRedactions,
          purchaseRedactions,
          runLoginRedactions,
          runCodeRedactions,
        ] = await Promise.all([
          deps.prisma.bot
            .findUniqueOrThrow({
              where: { id: run.botId },
              include: { computer: true },
            })
            .then(async (bot) => ({
              bot,
              ownerLabs: (
                await deps.prisma.user.findUnique({
                  where: { id: bot.userId },
                  select: { labs: true },
                })
              )?.labs,
            })),
          deps.prisma.thread.findUniqueOrThrow({
            where: { id: run.threadId },
            include: {
              space: { select: { _count: { select: { memberships: true } } } },
            },
          }),
          loadRunHistoryMessages(deps.prisma, run, LEGACY_HISTORY_WINDOW_SIZE, channelId),
          run.trigger === "bot_message"
            ? loadBotMessageContext(deps.prisma, run.sourceMessageId)
            : Promise.resolve(undefined),
          deps.prisma.task.findUniqueOrThrow({ where: { id: run.taskId } }),
          deps.prisma.connection.findMany({
            where: { userId: run.userId, spaceId: run.spaceId },
            select: {
              id: true,
              connectorId: true,
              provider: true,
              providerRef: true,
              displayName: true,
              status: true,
            },
          }),
          pinnedComputerModels ? Promise.resolve(null) : resolveMemberMainModel(deps, run),
          deps.prisma.deploymentSettings.findUnique({
            where: { id: "default" },
          }),
          deps.memoryProviders.resolve(run.spaceId),
          deps.prisma.taughtSkill.findMany({
            where: { botId: run.botId, spaceId: run.spaceId, status: "saved" },
          }),
          listAgentSkillRecords(deps.prisma, {
            spaceId: run.spaceId,
            userId: run.userId,
          }),
          loadCommandVariables(deps.prisma, deps.secretStore, run),
          loadLoginPasswordRedactions(deps.prisma, deps.secretStore, run),
          deps.paymentWallet ? loadPurchaseRedactions(deps, run) : [],
          loadRunLoginRedactions(deps.prisma, deps.secretStore, run, run.id),
          loadRunCodeRedactions(deps.prisma, deps.secretStore, run, run.id),
        ]);
        const teamChatConversationId =
          run.trigger === "messaging" ? thread.externalConversationId : null;
        const nonOwnerChatRun =
          messagingChannelRun ||
          (teamChatConversationId
            ? !(await teamChatRunFromOwner(deps.prisma, {
                externalConversationId: teamChatConversationId,
                sourceClientNonce: messagingSource?.clientNonce,
              }))
            : false);
        const replaysToolHistory = runReplaysToolHistory(run.trigger, {
          fromUser: messages.find((message) => message.id === run.sourceMessageId)?.role === "user",
          nonOwnerChat: nonOwnerChatRun,
        });
        const ticketBoardEnabled = hasLab(resolveLabs(ownerLabs, deps.deploymentLabs), "board");
        const historySearchBeforeSeq =
          contextStrategy !== "current" && run.sourceMessageId
            ? (messages.find((message) => message.id === run.sourceMessageId)?.seq ??
              (
                await deps.prisma.message.findUnique({
                  where: { id: run.sourceMessageId, threadId: thread.id },
                  select: { seq: true },
                })
              )?.seq ??
              thread.nextMessageSeq)
            : thread.nextMessageSeq;
        runSecrets.push(...commandRedactions);
        runSecrets.push(
          ...savedLoginPasswordRedactions,
          ...purchaseRedactions,
          ...runLoginRedactions,
          ...runCodeRedactions,
        );
        const agentEnvironmentInstruction = formatAgentEnvironmentInstruction(
          initialBotCommandEnvironment,
        );
        const modelChoice = runModelChoice(run, bot);
        const hasModelOverride = Boolean(modelChoice.modelProvider && modelChoice.modelId);
        const overrideCredential =
          !pinnedComputerModels && hasModelOverride && modelChoice.modelProvider
            ? await findConnectedModelCredential(
                deps.prisma,
                deps.secretStore,
                run,
                modelChoice.modelProvider,
                modelChoice.modelId,
              )
            : null;
        runAbortController = new AbortController();
        if (!lease.valid) runAbortController.abort();
        if (deps.shutdownSignal?.aborted) runAbortController.abort(deps.shutdownSignal.reason);
        const onShutdown = () => runAbortController?.abort(deps.shutdownSignal?.reason);
        deps.shutdownSignal?.addEventListener("abort", onShutdown);
        detachShutdown = () => deps.shutdownSignal?.removeEventListener("abort", onShutdown);
        const composioRows = storedConnections.filter(
          (connection) => connection.connectorId === "composio",
        );
        let liveSlugs: string[] = [];
        if (needsLivePluginSync(composioRows)) {
          const listing = await loadLivePluginSlugs(deps.listConnectedPluginSlugs, run.userId);
          if (listing.ok) {
            liveSlugs = listing.slugs;
            await persistLivePluginConnections(deps.prisma, run, composioRows, listing.slugs).catch(
              () => undefined,
            );
          }
        }
        const connectedComposio = mergeConnectedPlugins(composioRows, liveSlugs);
        const connectedPlugins = selectRunConnections(
          storedConnections,
          connectedComposio.map((connection) => connection.provider),
        );
        const context = {
          operationId: runId,
          traceId: runId,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          runId,
          screenLeaseId: screenLeaseIdForRun(computerLease, runId, fence),
          signal: runAbortController.signal,
          ...connectedContext(connectedPlugins),
          connectedProviders: connectedComposio.map((row) => row.provider),
        };
        const memoryScope = configuredMemory
          ? effectiveMemoryScope(bot.memoryScope, configuredMemory.defaultScope)
          : null;
        const semanticMemory: SemanticMemoryProvider | null = configuredMemory?.provider ?? null;

        await deps.events.append({
          spaceId: run.spaceId,
          threadId: thread.id,
          botId: bot.id,
          type: "run.started",
          runId,
          payload: {
            trigger: run.trigger,
            routineId: run.routineId,
            ...(run.routine ? { routineName: run.routine.name } : {}),
          },
        });

        const discoveredPromise = deps.connector
          ? deps.connector.discoverTools(context)
          : Promise.resolve([]);
        const cloudAgentPromise = cloudAgentForActor(executorDeps, {
          spaceId: run.spaceId,
          userId: run.userId,
          botIds: [bot.id],
        }).catch(() => null);
        const people = await loadSpacePeople(
          deps.prisma,
          thread.space?._count.memberships ?? 0,
          run.userId,
          messages,
        );
        const speakers = await loadThreadSpeakers(
          deps.prisma,
          thread,
          { spaceId: run.spaceId, bot },
          messages,
          people,
        );
        const threadContext = threadContextForRun(
          run.trigger,
          {
            messages: [...messages].reverse().map((m) => {
              const speaker = historySpeaker(speakers, m);
              const neutral = (value: string) =>
                speakers ? neutralizeSpeakerLabels(value) : value;
              const text = neutral(messageToAgentHistoryText(m));
              const partial = isPartialReplyClientNonce(m.clientNonce);
              const segments =
                m.role === "user" || m.role === "system" || speaker || !replaysToolHistory
                  ? undefined
                  : messageToAgentHistorySegments(m)?.map((segment) =>
                      "text" in segment
                        ? { text: neutral(segment.text) }
                        : {
                            steps: segment.steps.map((step) => ({
                              ...step,
                              ...(step.note ? { note: neutral(step.note) } : {}),
                              ...(step.calls
                                ? {
                                    calls: step.calls.map((call) =>
                                      call.result
                                        ? { ...call, result: neutral(call.result) }
                                        : call,
                                    ),
                                  }
                                : {}),
                            })),
                          },
                    );
              return {
                id: m.id,
                createdAt: m.createdAt?.toISOString(),
                seq: m.seq,
                role: (m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant") as
                  | "user"
                  | "assistant"
                  | "system",
                ...(speaker ? { speaker } : {}),
                waiting: m.steeringMessages.length > 0,
                content: partial ? `${text}\n\n${PARTIAL_REPLY_NOTE}` : text,
                ...(segments
                  ? { segments: partial ? [...segments, { text: PARTIAL_REPLY_NOTE }] : segments }
                  : {}),
              };
            }),
            summary: thread.historyCompactionSummary,
            historyCompactedUpToSeq: thread.historyCompactedUpToSeq,
          },
          nonOwnerChatRun,
          run.sourceMessageId,
        );
        const compactedHistory = selectCompactedHistory({
          messages: threadContext.messages,
          summary: threadContext.summary,
          historyCompactedUpToSeq: threadContext.historyCompactedUpToSeq,
        });
        let history = compactedHistory.history.map(
          ({ id, role, content, createdAt, speaker, segments }) => ({
            id,
            createdAt,
            role,
            content,
            ...(speaker ? { speaker } : {}),
            ...(segments ? { segments } : {}),
          }),
        );
        const historyMessages = messages
          .filter((message) => message.steeringMessages.length === 0)
          .map((message) => ({
            id: message.id,
            role: message.role,
            runId: message.runId,
            blocks: message.blocks as MessageBlock[],
          }));
        const currentTurnMessage = userTurnMessageForRun(
          run.trigger,
          runId,
          historyMessages,
          run.sourceMessageId,
        );
        const turnBlocks = currentTurnMessage?.blocks;
        const currentRunImageMessages = await deps.prisma.message.findMany({
          where: {
            threadId: thread.id,
            OR: [
              ...(run.sourceMessageId ? [{ id: run.sourceMessageId }] : []),
              { steeringMessages: { some: { runId, botId: run.botId } } },
            ],
            role: "user",
            blocks: { array_contains: [{ kind: "image" }] },
          },
          select: { id: true, blocks: true },
          orderBy: { seq: "asc" },
        });
        const confirmedRunImages = currentRunImageMessages.flatMap((message) =>
          (message.blocks as MessageBlock[]).filter(
            (block) => block.kind === "image" && block.imageHandling === "confirm",
          ),
        );
        const currentRunRequiresImageInput = confirmedRunImages.length > 0;
        const groupReplyOptional =
          Boolean(thread.groupId) && run.trigger === "user" && run.groupReplyOptional;
        const allowSilentPeerMessage = botMessageAllowsSilence(
          peerMessage?.intent,
          peerMessage?.repliesToRequest,
        );
        const allowSilentEmptyRun =
          allowSilentPeerMessage || messagingChannelRun || runAllowsSilentEmpty(run.trigger);
        const emptyResponseText = peerMessage
          ? peerMessage.intent === "result" ||
            peerMessage.intent === "status" ||
            peerMessage.intent === "question" ||
            peerMessage.repliesToRequest
            ? `Update from ${peerMessage.fromBotName}: ${peerMessage.text}`
            : DELEGATED_EMPTY_NOTICE
          : undefined;
        const capabilities = semanticMemory?.describe().capabilities;
        const recallsEachRun = capabilities?.recallEachRun === true;
        const compacted = thread.historyCompactedUpToSeq != null;
        const recallPromise =
          threadContext.includeSemanticRecall &&
          semanticMemory &&
          memoryScope &&
          capabilities?.recallOnRequestOnly !== true &&
          (compacted || recallsEachRun)
            ? semanticMemory.recall(
                {
                  query: task.prompt,
                  includeExternal: false,
                  scope: memoryScope,
                  botId: bot.id,
                  ...(compacted ? { historyGeneration: thread.historyCompactionGeneration } : {}),
                  limit: MAX_RECALLED_MEMORIES,
                },
                context,
              )
            : Promise.resolve(null);
        const [
          discovered,
          currentTurnImages,
          memoryContext,
          scratchpadContext,
          ticketContext,
          recalled,
        ] = await Promise.all([
          discoveredPromise,
          loadCurrentTurnImages(deps, turnBlocks, context),
          nonOwnerChatRun
            ? Promise.resolve("")
            : loadAgentMemoryContext(deps.memory, bot.id, context),
          nonOwnerChatRun
            ? Promise.resolve("")
            : loadAgentScratchpadContext(deps, {
                spaceId: run.spaceId,
                botId: bot.id,
              }),
          nonOwnerChatRun || !ticketBoardEnabled
            ? Promise.resolve(undefined)
            : loadAgentTicketContext(deps, {
                spaceId: run.spaceId,
                text: task.prompt,
              }),
          recallPromise,
        ]);
        const semanticMemoryEnabled = Boolean(semanticMemory) && !nonOwnerChatRun;
        let recalledMemory = "";
        let recallSucceeded = false;
        if (recalled) {
          if (recalled.ok) {
            const stored = recalled.value.filter((memory) => !memory.external);
            recallSucceeded = stored.length > 0;
            recalledMemory = stored.length ? formatRecalledMemory(stored) : "";
          } else {
            getLogger().error("semantic memory recall failed", recalled.error);
          }
        }
        if (!compactedHistory.usedLocalSummary) {
          history = history.slice(
            -historyWindowSize({
              semanticMemoryEnabled: semanticMemoryEnabled && !thread.historyCompactionSummary,
              compacted,
              recallSucceeded,
            }),
          );
        }
        const runDeployment = deps.deploymentModelConfigured ? resolveDeploymentModel() : null;
        const runtimeFallback = runtimeFallbackModel(deps.runtime);
        const pinError =
          !pinnedComputerModels &&
          run.modelPinned &&
          !(
            (await modelCreditBillingEnabled(deps)) &&
            modelChoice.modelProvider === runDeployment?.provider
          )
            ? pinnedModelCredentialError(modelChoice, overrideCredential)
            : undefined;
        const selected = pinnedComputerModels
          ? {
              provider: pinnedComputerModels.main.provider,
              id: pinnedComputerModels.main.id,
              thinkingLevel: pinnedComputerModels.main.thinkingLevel,
              credential: null,
            }
          : selectConfiguredModel({
              override: modelChoice,
              overrideCredential,
              main,
              hostedProvider: (await modelCreditBillingEnabled(deps))
                ? resolveDeploymentModel().provider
                : undefined,
              defaults: { settings, deployment: runDeployment },
            });
        const selectedProvider = selected.provider ?? runtimeFallback?.provider;
        const selectedModelId = selected.id ?? runtimeFallback?.id;
        const failRunBeforeModel = async (message: string, accountFailure = false) => {
          const failed = await failRunBeforeTurn(
            deps,
            run,
            bot.name,
            { attemptId: attempt.id, workerId, fence },
            message,
          );
          if (failed && accountFailure && run.trigger === "routine" && run.routineId) {
            await backOffRoutineAfterAccountError(deps, {
              routineId: run.routineId,
              userId: run.userId,
            });
          }
        };
        if (pinnedComputerFailure) {
          await failRunBeforeModel(pinnedComputerFailure, true);
          return;
        }
        if (pinError) {
          await failRunBeforeModel(pinError, pinError === PINNED_PROVIDER_NOT_CONNECTED);
          return;
        }
        if (
          !pinnedComputerModels &&
          run.modelPinned &&
          (selected.provider !== modelChoice.modelProvider || selected.id !== modelChoice.modelId)
        ) {
          await failRunBeforeModel(PINNED_PROVIDER_NOT_CONNECTED, true);
          return;
        }
        const scripted = deps.runtime.describe().capabilities.scripted;
        const registerRunSecrets = (values: string[]) => runSecrets.push(...values);
        const backups = runModelBackups(
          deps,
          run,
          { settings, deployment: runDeployment },
          scripted,
          registerRunSecrets,
        );
        const started = await startRunModel(
          deps,
          run,
          {
            provider: selectedProvider,
            id: selectedModelId,
            credential: selected.credential,
            thinkingLevel: selected.thinkingLevel,
          },
          pinnedComputerModels?.main,
          backups,
          registerRunSecrets,
        );
        if (started.failure) {
          await failRunBeforeModel(started.failure.message, started.failure.accountFailure);
          return;
        }
        const {
          provider: runModelProvider,
          id: runModelId,
          credential,
          thinkingLevel,
          resolved,
        } = started.start;
        runSecrets.push(...resolved.redact);
        if (!run.modelPinned) {
          await deps.prisma.run.updateMany({
            where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
            data: { modelProvider: runModelProvider, modelId: runModelId },
          });
        }

        if (!bot.computer) throw new Error("Bot has no computer");
        const storedComputer = bot.computer;
        const computerMode = parseComputerMode(storedComputer.scope);
        const artifacts = deps.artifacts;
        const recentFilesInput = {
          context,
          computerMode,
          skipMessageId: currentTurnMessage?.id,
          maxTurns: RECENT_TURN_IMAGE_TURNS,
        };
        const earlierFiles = createEarlierFileQueue();
        const runComputer = lazyRunComputer(
          async () => {
            getLogger().info("computer.requested");
            const computer = await provisionComputer(deps, storedComputer.id, context, "bot");
            earlierFiles.computerStarted();
            computerUse.screenRelease = { computer, context, keepWarm: false };
            recordComputerDisk(deps, storedComputer.id, computer, context);
            scheduleComputerSleep(deps.jobs, storedComputer.id);
            if (artifacts) {
              await materializeRecentThreadFiles({ ...deps, artifacts }, history, historyMessages, {
                ...recentFilesInput,
                computer: async () => computer,
              });
            }
            return computer;
          },
          () => runAbortController?.abort(),
        );
        const computerKind =
          (await deps.sandbox.provisionKind?.(storedComputer.homeKey)) ?? storedComputer.kind;
        const workspaceCheckpoint = createRunWorkspaceCheckpoint(
          async () => {
            if (!runComputer.ready) return;
            await checkpointRunComputerWorkspace(deps, storedComputer, runComputer.ready, context);
          },
          { id: storedComputer.id, kind: computerKind },
          context.signal,
        );
        const pendingTurnFiles: MessageBlock[][] = [turnBlocks ?? []];
        let copyingTurnFiles = Promise.resolve();
        const getRunComputer = async (reason: "tool" | "takeover" | "script", tool?: string) => {
          if (computerUse.reason === "none") {
            computerUse.reason = reason;
            computerUse.tool = tool && BUILTIN_AGENT_TOOL_NAMES.has(tool) ? tool : undefined;
          }
          return getLogger().withContext(
            {
              reason: computerUse.reason,
              tool: computerUse.tool,
              trigger: run.trigger,
              "run.id": runId,
              "computer.id": storedComputer.id,
            },
            async () => {
              const computer = await runComputer.get();
              copyingTurnFiles = copyingTurnFiles
                .catch(() => undefined)
                .then(async () => {
                  while (artifacts && pendingTurnFiles.length) {
                    const files = await materializeCurrentTurnFiles(
                      { ...deps, artifacts },
                      pendingTurnFiles[0],
                      {
                        context,
                        computer: async () => computer,
                        computerMode,
                        markWorkspaceDirty: workspaceCheckpoint.markDirty,
                      },
                    );
                    workspaceCheckpoint.markFiles(files);
                    pendingTurnFiles.shift();
                  }
                  const earlier = earlierFiles.take();
                  if (artifacts && earlier.length) {
                    earlierFiles.copiedTo(
                      earlier,
                      await materializeEarlierFiles({ ...deps, artifacts }, earlier, {
                        context,
                        computer: async () => computer,
                        computerMode,
                        markWorkspaceDirty: workspaceCheckpoint.markDirty,
                      }),
                    );
                  }
                });
              await copyingTurnFiles;
              return computer;
            },
          );
        };
        let currentTurnFiles: Awaited<ReturnType<typeof listCurrentTurnFiles>> = [];
        let recentThreadFiles: Awaited<ReturnType<typeof listRecentThreadFiles>> = [];
        try {
          if (artifacts) {
            currentTurnFiles = await listCurrentTurnFiles(deps, turnBlocks, context);
            recentThreadFiles = await listRecentThreadFiles(
              deps,
              history,
              historyMessages,
              recentFilesInput,
            );
          }
        } catch (error) {
          await workspaceCheckpoint.flush().catch(() => undefined);
          throw error;
        }
        const attachedFilesPrompt = [
          currentTurnFilesInstruction(currentTurnFiles),
          recentThreadFilesInstruction(recentThreadFiles),
        ]
          .filter(Boolean)
          .join("\n\n");
        const hostEnvironment = sandboxKindCapabilities(computerKind).nativeShell
          ? await bestEffort(
              "read this computer's environment",
              Promise.resolve(
                deps.sandbox.environment?.(
                  {
                    id: storedComputer.providerRef ?? storedComputer.id,
                    botId: storedComputer.homeKey,
                    kind: computerKind as ComputerRef["kind"],
                    providerRef: storedComputer.providerRef ?? "",
                  },
                  {
                    ...context,
                    signal: AbortSignal.any([context.signal, AbortSignal.timeout(2000)]),
                  },
                ),
              ),
            )
          : undefined;
        const graphical = sandboxKindCapabilities(computerKind).runsOnUserMachine
          ? hostGraphical(storedComputer.id, run.userId, hostEnvironment?.screen)
          : deps.sandbox.describe().capabilities.graphical;
        const modelSeesImages = modelAcceptsImageInput(
          runModelProvider,
          runModelId,
          resolved.acceptsImages,
        );

        const groupContext = thread.groupId
          ? await loadGroupContext(
              deps.prisma,
              thread.groupId,
              { id: bot.id, name: bot.name },
              Boolean(people),
            )
          : undefined;
        const hasMessagingIdentity = deps.messaging
          ? await deps.messaging.hasIdentity(bot.id)
          : false;
        const paymentWallet = deps.paymentWallet;
        const paymentWalletEnabled = paymentWallet
          ? await paymentWalletConnected(
              {
                prisma: deps.prisma,
                secretStore: deps.secretStore,
                jobs: deps.jobs,
                paymentWallet,
              },
              run.userId,
            )
          : false;
        const messagingContext =
          [
            hasMessagingIdentity ? messagingDmSurfaceNote() : null,
            messagingChannelRun
              ? messagingChannelPrivacyBlock()
              : nonOwnerChatRun
                ? nonOwnerChatPrivacyBlock()
                : null,
          ]
            .filter(Boolean)
            .join("\n\n") || undefined;
        if (heldForTakeover) {
          const held = await deps.prisma.run.findUnique({
            where: { id: runId },
            select: { status: true, checkpoint: true },
          });
          if (held) {
            ({ resumeCheckpoint, heldForTakeover, takeoverResume } = refreshTakeoverContinuePlan(
              { resumeCheckpoint, heldForTakeover, takeoverResume },
              held,
            ));
          }
        }
        const mainRunModel: AgentRunRequest["model"] = pinnedComputerModels?.main ?? {
          provider: runModelProvider,
          id: runModelId,
          ...(credential ? { connectionId: credential.id } : {}),
          ...resolvedModelRunFields(resolved),
          thinkingLevel: thinkingLevel ?? null,
        };
        const computerModel =
          pinnedComputerModels?.computer ??
          (scripted || storedTurnCheckpoint || !graphical
            ? undefined
            : await resolveComputerRunModel(
                {
                  prisma: deps.prisma,
                  resolve: resolveCheckpointModel,
                  connectionFor: async (provider, modelId) =>
                    (
                      await findConnectedModelCredential(
                        deps.prisma,
                        deps.secretStore,
                        run,
                        provider,
                        modelId,
                      )
                    )?.id,
                },
                { userId: run.userId, spaceId: run.spaceId },
                mainRunModel,
              ));
        const sourceMessage =
          (run.trigger === "user" || run.trigger === "follow_up") && run.sourceMessageId
            ? await deps.prisma.message.findUnique({
                where: { id: run.sourceMessageId },
                select: {
                  clientNonce: true,
                  role: true,
                  blocks: true,
                  threadId: true,
                },
              })
            : null;
        const sourceClientNonce = sourceMessage?.clientNonce ?? null;
        const ownerStartedRun = isOwnerStartedRun(run.trigger, sourceMessage?.role === "user");
        const callEndRun = run.trigger === "call_end";
        const callClientNonceForRun = callEndRun ? run.clientNonce : sourceClientNonce;
        const voiceCall = callEndRun || isCallClientNonce(sourceClientNonce);
        const acceptsImages =
          deps.runtime.describe().capabilities.scripted ||
          modelSeesImages ||
          Boolean(computerModel || checkpointModelResolver);
        const graphicalToolsAllowed = graphical && acceptsImages && !heldForTakeover;
        const pageBrowserAllowed =
          graphical && browser.describe().capabilities.page && !heldForTakeover;
        const disabledBuiltinTools = disabledBuiltinToolSet(bot.disabledBuiltinTools);
        const replyMode = runReplyMode(run.trigger, bot.replyMode, disabledBuiltinTools);
        const emailName = deps.inboundEmailDomain
          ? await deps.prisma.botEmailAddress.findUnique({
              where: { botId: bot.id },
              select: { name: true },
            })
          : null;
        const botEmail = emailName ? `${emailName.name}@${deps.inboundEmailDomain}` : null;
        const emailInbox =
          Boolean(botEmail) &&
          run.userId === bot.userId &&
          run.trigger !== "bot_message" &&
          !thread.groupId &&
          !nonOwnerChatRun;
        const userComputerOwnerId = userComputerOwner({
          trigger: run.trigger,
          sourceRole: sourceMessage?.role,
          messagingChannelRun: nonOwnerChatRun,
          runUserId: run.userId,
          botUserId: bot.userId,
        });
        let userComputer: UserComputerState;
        let userComputerShell = false;
        let userComputerScreen = false;
        let macApps = false;
        if (
          userComputerOwnerId &&
          deps.userDevices &&
          !disabledBuiltinTools.has(USER_COMPUTER_SHELL_TOOL)
        ) {
          const device = await deps.userDevices.connected(userComputerOwnerId).catch(() => null);
          if (device) {
            userComputer = "connected";
            userComputerShell = !device.screenOnly;
            userComputerScreen = device.platform === "darwin" || device.platform === "win32";
            macApps = device.platform === "darwin";
          } else userComputer = "offline";
        }
        const cloudAgent = await cloudAgentPromise;
        const cloudAgentCleanupEnabled = Boolean(
          !cloudAgent &&
            deps.userCloudAgents &&
            (await deps.prisma.cloudAgent
              .findFirst({
                where: {
                  spaceId: run.spaceId,
                  userId: run.userId,
                  providerKey: { startsWith: USER_CLOUD_AGENT_KEY_PREFIX },
                },
                select: { id: true },
              })
              .catch((error: unknown) => {
                getLogger().warn("cloud_agent.cleanup_lookup_failed", { error });
                return null;
              })),
        );
        const builtins = [
          ...selectBuiltinToolsForRun({
            ticketBoardEnabled,
            phoneCallsEnabled: deps.phoneCallsEnabled && run.userId === bot.userId,
            historyRetrievalEnabled: contextStrategy !== "current",
            graphicalToolsAllowed,
            pageBrowserAllowed,
            groupId: thread.groupId,
            trigger: run.trigger,
            semanticMemoryEnabled,
            semanticMemoryForgets: Boolean(semanticMemory?.forget),
            semanticMemoryReflects: Boolean(semanticMemory?.reflect),
            mediaImagesEnabled: Boolean(deps.artifacts && mediaGeneration?.capabilities.images),
            mediaVideoEnabled: Boolean(deps.artifacts && mediaGeneration?.capabilities.video),
            paidServicesEnabled: Boolean(paidServices),
            cloudAgentEnabled: Boolean(cloudAgent),
            cloudAgentCleanupEnabled,
            paymentWalletEnabled,
            messagingChannelRun: nonOwnerChatRun,
            voiceCall,
            disabledBuiltinTools: groupReplyOptional
              ? [...(bot.disabledBuiltinTools ?? []), "handoff_to_bot"]
              : bot.disabledBuiltinTools,
            fleetManagement: bot.fleetManagement,
            followUpFromUser: sourceMessage?.role === "user",
            userComputer: userComputerShell,
            userComputerScreen,
            macApps,
            emailInbox,
            emailClaimable:
              Boolean(deps.inboundEmailDomain) && !emailName && run.userId === bot.userId,
            emailSend: Boolean(deps.email),
          }),
          ...(run.userId === bot.userId &&
          offersAgentConnectionTools({
            hasMessagingIdentity,
            crossSpaceCommunication: bot.crossSpaceCommunication === true,
            trigger: run.trigger,
          })
            ? agentConnectionTools.filter((tool) => !disabledBuiltinTools.has(tool.name))
            : []),
        ];
        const strategicBuiltins = filterStrategicInitiativeTools(builtins, {
          trigger: run.trigger,
          clientNonce: run.clientNonce,
        });
        const exposedConnectorTools = discovered.filter(
          (tool) => !builtinAgentTools.some((builtin) => builtin.name === tool.name),
        );
        const strategicConnectorTools = filterStrategicInitiativeTools(exposedConnectorTools, {
          trigger: run.trigger,
          clientNonce: run.clientNonce,
        });
        const connectorTools = new Map(
          strategicConnectorTools.map((tool) => [tool.name, tool] as const),
        );
        const trustLoaders = createRunTrustLoaders(deps, {
          run,
          runId,
          botId: bot.id,
          taskPrompt: task.prompt,
          ownerStartedRun,
          messagingChannelRun: nonOwnerChatRun,
          sourceMessage,
          ownerChatMessageBlocks: nonOwnerChatRun ? undefined : messagingSource?.blocks,
          connectedPlugins,
        });
        const searchResultUrls = new Set<string>();
        const initiallyTainted =
          !ownerStartedRun ||
          Boolean(turnCheckpoint) ||
          Boolean(checkpointLoadError) ||
          historyReplaysOutsideContent(history);
        const tools =
          run.trigger === "created"
            ? strategicBuiltins
            : [...strategicBuiltins, ...strategicConnectorTools];
        const taskCatalogInstruction = tools.some((tool) => tool.name === "task_catalog")
          ? TASK_CATALOG_GUIDANCE
          : undefined;
        const approvedEffects = await deps.prisma.externalEffect.findMany({
          where: { runId, status: "approved" },
          orderBy: APPROVED_EFFECT_REPLAY_ORDER,
          select: { kind: true, request: true, idempotencyKey: true },
        });
        const approvedEffectReplays = createApprovedEffectReplayQueue(approvedEffects);
        const baseComputerInstruction = persistentComputerInstruction({
          heldForTakeover,
          graphicalToolsAllowed,
          graphical,
          disabled: disabledBuiltinTools,
        });
        const dockerToolInstruction = dockerComputerToolInstruction(
          computerKind,
          disabledBuiltinTools,
          new Set(tools.map((tool) => tool.name)),
        );
        const hostInstruction = hostEnvironment
          ? hostComputerInstruction(computerKind, hostEnvironment)
          : undefined;
        const computerInstruction = [
          COMPUTER_USE_INSTRUCTION,
          hostInstruction
            ? `${baseComputerInstruction} ${hostInstruction}`
            : dockerToolInstruction
              ? `${baseComputerInstruction} ${dockerToolInstruction}`
              : baseComputerInstruction,
          diskNoteInstruction(storedComputer),
        ]
          .filter(Boolean)
          .join(" ");
        const workspaceInstruction =
          computerMode === "team"
            ? teamWorkspaceInstruction(bot.id)
            : PRIVATE_WORKSPACE_INSTRUCTION;

        const reply = await createReplyState(deps, run, runSecrets);
        const script = scripted ? inferScript(task.prompt, takeoverResume?.checkpoint) : undefined;
        const state: RunState = {
          lease,
          computerUse,
          runningHelpers,
          reply,
          approval: { pausePending: false, request: undefined },
          effects: {
            counts: new Map(),
            occurrences: [],
            restoredPending: undefined,
            consumedIds: new Set(),
            pendingTurnCheckpoints: new Map(),
            storedTurnCheckpoint,
          },
          screen: {
            lastFrameId: undefined,
            unchangedVisualStreak: { count: 0 },
            turn: { controlFence: undefined, mustLook: false },
          },
          toolCallStreak: { key: undefined, count: 0 },
          overLimitActionCalls: 0,
          toolResults: new Map(),
          tainted: initiallyTainted,
          ownerSettingsRefused: false,
          ownInstructionsBaseline: bot.instructions ?? "",
          earlierAttempt: undefined,
          walletHosts: new Set(),
          vaultUses: new Set(),
          handedOff: false,
          terminalCheckpointComplete: false,
        };
        const { effects } = state;
        const fleetRun: FleetRun = {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          groupId: thread.groupId ?? null,
          threadId: thread.id,
          runId,
        };

        const ctx: RunContext = {
          deps,
          providers: { web, mediaGeneration, paidServices, browser, cloudAgent },
          run,
          runId,
          workerId,
          fence,
          attempt,
          bot,
          thread,
          task,
          context,
          abortController: runAbortController,
          runtimeAbortController: new AbortController(),
          fleetRun,
          secrets: runSecrets,
          source: {
            ownerStartedRun,
            messagingChannelRun: nonOwnerChatRun,
            channelId,
            historySearchBeforeSeq,
            myChatsAllowed: historyMyChatsAllowed(
              run,
              sourceMessage,
              nonOwnerChatRun ||
                Boolean(
                  channelId ||
                    thread.externalConversationId ||
                    messagingChannelId(sourceMessage?.blocks as MessageBlock[] | undefined),
                ),
            ),
            voiceCall,
            callEndRun,
            callClientNonce: callClientNonceForRun,
            peerMessage,
            userComputerOwner: userComputerOwnerId,
          },
          computer: {
            stored: storedComputer,
            kind: computerKind,
            mode: computerMode,
            lease: computerLease,
            lazy: runComputer,
            get: getRunComputer,
            copyEarlierFiles: earlierFiles.add,
            checkpoint: workspaceCheckpoint,
            hostEnvironment,
            graphical,
            graphicalToolsAllowed,
            pageBrowserAllowed,
            acceptsImages,
            heldForTakeover,
          },
          tools: {
            offered: tools,
            builtins: strategicBuiltins,
            connector: connectorTools,
            disabled: disabledBuiltinTools,
            connectedPlugins,
            approvedReplays: approvedEffectReplays,
          },
          trust: { ...trustLoaders, searchResultUrls },
          memory: {
            semantic: semanticMemory,
            scope: memoryScope,
          },
          scripted,
          script,
          allowSilentEmptyRun,
          groupReplyOptional,
          emptyResponseText,
          replyMode,
          state,
          settleRunningHelpers: settleHelpers,
          stopHeartbeatAfterCompletion,
        };
        const pluginLine =
          connectedPlugins.length > 0
            ? `Connected plugins: ${connectedPlugins.map((row) => `${row.displayName} (${row.connectorId}:${row.provider})`).join(", ")}. Prefer those plugin tools over the computer browser or web search when reading app data (repos, releases, mail, calendar, and similar).`
            : "No plugins are connected yet.";
        const runSavedSkills = nonOwnerChatRun ? [] : savedSkills;
        const runAgentSkills = nonOwnerChatRun ? builtinAgentSkillRecords() : agentSkills;
        const taughtSkillIndex = runSavedSkills.slice(0, 20);
        const taughtSkillsLine =
          taughtSkillIndex.length > 0
            ? `Saved taught skills:\n${taughtSkillIndex
                .map((skill) => {
                  const playbook = parsePlaybook(skill.playbook);
                  const name = skill.name || skill.goal.slice(0, 80);
                  return `- ${name}: ${playbook.whenToUse || skill.goal}`;
                })
                .join(
                  "\n",
                )}\nWhen the user asks to run a taught skill by name, follow that skill's playbook exactly. The full playbook is included in the user task when they invoke it.`
            : undefined;
        const agentSkillsLine = formatSkillsCatalogInstruction(runAgentSkills);
        const missingImagesInstruction = missingTurnImagesInstruction(
          turnBlocks,
          currentTurnImages,
        );
        const taskPrompt = expandSkillReferencesInPrompt(
          [task.prompt, attachedFilesPrompt, missingImagesInstruction].filter(Boolean).join("\n\n"),
          runAgentSkills,
        );
        const invokedSkill = runSavedSkills.find(
          (skill) =>
            (ownerStartedRun || skill.userId === run.userId) &&
            promptInvokesSkill(taskPrompt, skill.name || skill.goal),
        );
        const basePrompt = invokedSkill
          ? `${formatSkillRunPrompt(
              invokedSkill.name || invokedSkill.goal.slice(0, 80),
              parsePlaybook(invokedSkill.playbook),
            )}\n\n${taskPrompt}`
          : taskPrompt;
        if (turnCheckpoint) {
          turnCheckpoint = restoreTurnCheckpointEffects(
            ctx,
            turnCheckpoint,
            {
              provider: runModelProvider,
              id: runModelId,
            },
            savedComputerMode?.mode,
          );
          if (checkpointModelResolver && !turnCheckpoint)
            throw new Error("Pinned computer mode checkpoint cannot be restored");
        }
        const approvalContinuation = turnCheckpoint
          ? undefined
          : buildApprovalContinuation(
              approvedEffects,
              (request) => redactSecrets(JSON.stringify(request), runSecrets),
              { exposedToolNames: new Set(partitionTools(tools).listed.map((tool) => tool.name)) },
            );
        const replyContext = await loadReplyContext(deps.prisma, thread.id, run.sourceMessageId);
        let userTimeZone: string | null | undefined;
        try {
          userTimeZone = (
            await deps.prisma.user.findUnique({
              where: { id: run.userId },
              select: { timezone: true },
            })
          )?.timezone;
        } catch {}
        let lateRoutineNote: string | undefined;
        const lateSince = current.lateSince ?? firstLateSince;
        if (lateSince && run.routineId) {
          try {
            const routine = await deps.prisma.routine.findUnique({
              where: { id: run.routineId },
              select: { timezone: true },
            });
            if (routine)
              lateRoutineNote = lateRoutineRunInstruction(
                lateSince,
                executionStartedAt,
                routine.timezone,
              );
          } catch {}
        }
        const sharedSpaceNote = people
          ? await loadSharedSpaceNote(deps.prisma, run.spaceId, run.userId)
          : undefined;
        const prompt = [
          replyContext,
          run.trigger === "reaction" && replyContext ? undefined : basePrompt,
          takeoverResume?.promptNote,
          approvalContinuation,
          voiceCall && !callEndRun ? voiceCallInstruction(disabledBuiltinTools) : undefined,
          formatCurrentTimeInstruction(deps.now?.() ?? new Date(), userTimeZone),
          lateRoutineNote,
          sharedSpaceNote,
        ]
          .filter(Boolean)
          .join("\n\n");
        const historicalContext: AgentRunRequest["history"] = [];
        if (compactedHistory.usedLocalSummary && compactedHistory.summary) {
          historicalContext.push({
            role: "user",
            content: redactSecrets(
              formatCompactedSummary(compactedHistory.summary, thread.historyCompactedUpToSeq!),
              runSecrets,
            ),
          });
        }
        if (recalledMemory) {
          historicalContext.push({
            role: "user",
            content: redactSecrets(recalledMemory, runSecrets),
          });
        }
        const modelImageBudget =
          resolved.maxImagesPerPrompt === undefined
            ? undefined
            : Math.max(0, resolved.maxImagesPerPrompt - (currentTurnImages?.length ?? 0));
        const historyWithImages = modelSeesImages
          ? await withLatestStepScreenshot(
              deps,
              await withRecentTurnImages(deps, history, historyMessages, context, {
                skipMessageId: currentTurnMessage?.id,
                maxImages: modelImageBudget,
              }),
              context,
            )
          : history;
        const runtimeHistory = [...historicalContext, ...historyWithImages];
        const [teammates, groupDirectory] = await Promise.all([
          thread.groupId
            ? []
            : deps.prisma.bot.findMany({
                where: {
                  spaceId: run.spaceId,
                  archivedAt: null,
                  id: { not: bot.id },
                  thread: { isNot: null },
                },
                select: { id: true, name: true, description: true },
                orderBy: { createdAt: "asc" },
                take: BOT_DIRECTORY_LIMIT,
              }),
          !thread.groupId ? loadBotGroupDirectory(deps.prisma, run) : undefined,
        ]);
        const botDirectory =
          [renderBotDirectory(teammates), groupDirectory].filter(Boolean).join("\n\n") || undefined;

        if (heldForTakeover) {
          const releasedCheckpoint = takeoverCheckpointOf(
            (
              await deps.prisma.run.findUnique({
                where: { id: runId },
                select: { checkpoint: true },
              })
            )?.checkpoint,
          );
          if (releasedCheckpoint) {
            await requeueComputerRun(deps, runId, workerId, fence, releasedCheckpoint, false);
            return;
          }
        }

        const beforeModel = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true, leaseOwner: true, leaseFence: true },
        });
        if (
          !mayOpenModelStream(
            beforeModel,
            workerId,
            fence,
            !lease.valid || Boolean(runAbortController?.signal.aborted),
          )
        ) {
          return;
        }

        const verbatimMcpServers = await verbatimMcpServersForRun(deps.prisma, {
          botId: bot.id,
          spaceId: run.spaceId,
          userId: run.userId,
        });
        const fallbackModels = (await backups.load()).filter(
          (candidate) =>
            !backups.unavailable.has(candidate) &&
            (candidate.provider !== runModelProvider ||
              candidate.modelId !== runModelId ||
              (candidate.credentialId !== undefined &&
                candidate.credentialId !== mainRunModel.connectionId)),
        );
        const fallbackKey = (provider: string, modelId: string, credentialId?: string | null) =>
          JSON.stringify([provider, modelId, credentialId ?? null]);
        const fallbackModelKeys = new Set(
          fallbackModels.map((candidate) =>
            fallbackKey(candidate.provider, candidate.modelId, candidate.credentialId),
          ),
        );
        const fallbackModelIds = new Set(
          fallbackModels.map((candidate) => fallbackKey(candidate.provider, candidate.modelId)),
        );
        const activeModel = { "model.provider": runModelProvider, "model.id": runModelId };
        const interruptedByShutdown = async () => {
          if (!deps.shutdownSignal?.aborted) return false;
          if (!ctx.state.terminalCheckpointComplete) {
            await ctx.computer.checkpoint.flush().catch(() => undefined);
          }
          return true;
        };

        try {
          if (checkpointLoadError) throw checkpointLoadError;
          await Promise.resolve()
            .then(() =>
              deps.prisma.run.updateMany({
                where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
                data: { promptVersion: promptVersion() },
              }),
            )
            .catch((error: unknown) => getLogger().warn("run.prompt_version_failed", { error }));
          const runtimeEvents = deps.runtime.run(
            {
              botId: bot.id,
              fastMode: bot.fastMode,
              verbatimMcpServers,
              threadId: thread.id,
              runId,
              routineId: run.routineId,
              sourceMessageId: run.sourceMessageId,
              onUsage: async (event) => {
                await recordUsage(deps.prisma, event, {
                  spaceId: run.spaceId,
                  botId: bot.id,
                  userId: run.userId,
                  runId,
                  parentRunId: runId,
                  operationId: runId,
                });
              },
              prompt,
              ...(speakers &&
              (run.trigger === "user" ||
                (run.trigger === "follow_up" && sourceMessage?.role === "user"))
                ? { promptSpeaker: personSpeaker(people, run.userId) }
                : {}),
              contextStrategy: deps.contextStrategy,
              instructions: userTurnInstructions({
                botInstructions: [
                  runIdentityInstruction(bot, run.trigger),
                  botEmail
                    ? botEmailInstruction(botEmail, {
                        read: emailInbox && !disabledBuiltinTools.has("read_email"),
                        send:
                          emailInbox &&
                          Boolean(deps.email) &&
                          !disabledBuiltinTools.has("send_email"),
                        delete: emailInbox && !disabledBuiltinTools.has("delete_email"),
                      })
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                groupContext: groupReplyOptional
                  ? [groupContext, GROUP_UNADDRESSED_REPLY_GUIDANCE].filter(Boolean).join("\n")
                  : groupContext,
                messagingContext,
                redactedMemoryContext: memoryContext
                  ? redactSecrets(memoryContext, runSecrets)
                  : undefined,
                redactedScratchpadContext: scratchpadContext
                  ? redactSecrets(scratchpadContext, runSecrets)
                  : undefined,
                redactedTicketContext: ticketContext
                  ? redactSecrets(ticketContext, runSecrets)
                  : undefined,
                hasHistoricalContext: historicalContext.length > 0,
                historyRetrievalEnabled:
                  contextStrategy !== "current" &&
                  tools.some((tool) => tool.name === "search_history"),
                computerInstruction,
                pageBrowserAllowed,
                taskCatalogInstruction,
                workspaceInstruction,
                agentEnvironmentInstruction,
                botDirectory,
                pluginLine,
                agentSkillsLine,
                taughtSkillsLine,
                replyGuidance: runReplyGuidance(run.trigger, replyMode),
                disabledBuiltinTools:
                  isStrategicInitiativeRun(run) || run.trigger === BACKGROUND_HELPER_TRIGGER
                    ? new Set(
                        builtinAgentTools
                          .map((tool) => tool.name)
                          .filter((name) => !strategicBuiltins.some((tool) => tool.name === name)),
                      )
                    : disabledBuiltinTools,
                offeredFleetTools: offeredFleetTools(strategicBuiltins),
                followUpsOffered: followUpsOffered(strategicBuiltins, ownerStartedRun),
                backgroundHelpersAllowed: backgroundHelpersAllowed({
                  threadBotId: thread.botId,
                  botId: bot.id,
                  trigger: run.trigger,
                }),
                userComputer,
                macApps: strategicBuiltins.some((tool) => isMacAppTool(tool.name)),
              })
                .filter((instruction): instruction is string => Boolean(instruction))
                .join("\n\n"),
              history: runtimeHistory,
              currentTurnImages,
              currentRunRequiresImageInput,
              currentTurnImageFileFallback: Boolean(
                currentTurnImages?.length &&
                  currentTurnFiles.length &&
                  !turnBlocks?.some(
                    (block) => block.kind === "image" && block.imageHandling === "confirm",
                  ),
              ),
              tools,
              secrets: runSecrets,
              model: mainRunModel,
              computerModel,
              fallbackModels: fallbackModels.map(({ provider, modelId, credentialId }) => ({
                provider,
                id: modelId,
                ...(credentialId ? { connectionId: credentialId } : {}),
              })),
              resolveFallbackModel:
                checkpointModelResolver || fallbackModelKeys.size
                  ? async (provider, modelId, connectionId) => {
                      if (checkpointModelResolver?.has(provider, modelId, connectionId))
                        return checkpointModelResolver(provider, modelId, connectionId);
                      const key = fallbackKey(provider, modelId, connectionId);
                      if (!fallbackModelKeys.has(key))
                        throw new Error("Backup model is not selected");
                      return resolveConnectedModel(
                        { userId: run.userId, spaceId: run.spaceId },
                        provider,
                        modelId,
                        (values) => runSecrets.push(...values),
                        true,
                        fallbackModels.find(
                          (candidate) =>
                            fallbackKey(
                              candidate.provider,
                              candidate.modelId,
                              candidate.credentialId,
                            ) === key,
                        )?.thinkingLevel ?? null,
                        connectionId,
                      );
                    }
                  : undefined,
              onModelChange: async (provider, modelId, computerMode) => {
                const roleModel =
                  [mainRunModel, computerModel].some(
                    (model) => model?.provider === provider && model.id === modelId,
                  ) || checkpointModelResolver?.hasModel(provider, modelId);
                if (!roleModel && !fallbackModelIds.has(fallbackKey(provider, modelId))) {
                  throw new Error("Model is not selected");
                }
                if (!computerMode) {
                  const updated = await deps.prisma.run.updateMany({
                    where: {
                      id: runId,
                      status: "running",
                      leaseOwner: workerId,
                      leaseFence: fence,
                    },
                    data: { modelProvider: provider, modelId },
                  });
                  if (updated.count !== 1) {
                    throw new Error("Run lease was lost before the backup model could be used");
                  }
                }
                activeModel["model.provider"] = provider;
                activeModel["model.id"] = modelId;
              },
              resumeFromCheckpoint: takeoverResume?.checkpoint,
              turnCheckpoint,
              onCheckpoint: async (capture, executionId) => {
                effects.pendingTurnCheckpoints.set(executionId, capture);
              },
              resumeToolResult: {
                content: [{ type: "text", text: takeoverResume?.promptNote ?? taskPrompt }],
              },
              script,
              allowSilentEmpty: allowSilentEmptyRun,
              emptyResponseText,
              executeTool: scripted
                ? undefined
                : (name, args, executionId, route, observer) =>
                    applyTool(ctx, name, args, executionId, route, observer),
              resolveModel: scripted
                ? undefined
                : (provider, modelId) =>
                    resolveConnectedModel(run, provider, modelId, (values) =>
                      runSecrets.push(...values),
                    ),
              onToolCompleted: (completion) => {
                if (effects.restoredPending?.executionId === completion.executionId)
                  effects.restoredPending = undefined;
                if (!completion.paused)
                  effects.pendingTurnCheckpoints.delete(completion.executionId);
                const outcome = toolCompletionOutcome(completion);
                if (outcome) state.reply.toolOutcomes.set(completion.executionId, outcome);
                keepToolStepResult(state.reply, completion, runSecrets);
                const audited = appendToolCompletionAudit(
                  deps,
                  {
                    spaceId: run.spaceId,
                    threadId: thread.id,
                    botId: bot.id,
                    runId,
                  },
                  completion,
                  runSecrets,
                );
                state.toolResults.set(
                  completion.executionId,
                  toolResultFingerprint(completion.result, completion.error),
                );
                return audited;
              },
              claimSteering: (seenIds) =>
                claimRunSteering(
                  deps,
                  {
                    threadId: thread.id,
                    botId: bot.id,
                    runId,
                    leaseOwner: workerId,
                    leaseFence: fence,
                  },
                  seenIds,
                  context,
                  pendingTurnFiles,
                  {
                    messageId: currentTurnMessage?.id,
                    hasImages: Boolean(currentTurnImages?.length),
                  },
                ),
            },
            {
              ...context,
              signal: AbortSignal.any([context.signal, ctx.runtimeAbortController.signal]),
            },
          );
          if (await consumeRunEvents(ctx, runtimeEvents)) return;
          if (await interruptedByShutdown()) return;
          await completeRun(ctx);
        } catch (turnError) {
          if (await interruptedByShutdown()) return;
          let caughtError = turnError;
          if (handoffEndedTurn(state, caughtError)) {
            try {
              await completeRun(ctx);
              return;
            } catch (completionError) {
              caughtError = completionError;
            }
          }
          if (isDatabaseUnavailable(caughtError)) {
            await requeueRunAfterDatabaseOutage(ctx);
            return;
          }
          await failRun(ctx, caughtError, {
            ownCredential: resolved.ownCredential,
            active: activeModel,
          });
        }
      } catch (setupError) {
        await retryRunSetup(
          deps,
          run,
          { id: attempt.id, workerId, fence },
          {
            resumeCheckpoint,
            heldForTakeover,
            dispatchHandedOff,
            leaseValid: lease.valid,
            secrets: runSecrets,
          },
          setupError,
        );
      } finally {
        getLogger().info("run.computer", {
          "run.id": runId,
          trigger: run.trigger,
          reason: computerUse.reason,
          tool: computerUse.tool,
          ready: Boolean(computerUse.screenRelease),
        });
        detachShutdown?.();
        clearInterval(heartbeat);
        await finishRunAttempt(
          deps,
          run,
          { id: attempt.id, workerId, fence },
          { lease, computerUse, computerLease },
          { endRunConnectorState, settleHelpers },
        );
      }
    },
  };
}

async function cancelRunOfFormerMember(
  deps: ExecutorDeps,
  run: {
    id: string;
    spaceId: string;
    userId: string;
    threadId: string;
    botId: string;
  },
): Promise<boolean> {
  const member = await deps.prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: run.spaceId, userId: run.userId } },
    select: { id: true },
  });
  if (member) return false;
  const cancelled = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.run.findUnique({
      where: { id: run.id },
      select: {
        id: true,
        taskId: true,
        userId: true,
        spaceId: true,
        status: true,
      },
    });
    if (!current || isTerminal(current.status as RunStatus)) return null;
    const [stopped] = await cancelRunsInTransaction(tx, [current], new Date());
    if (!stopped) return null;
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      runId: run.id,
      type: "run.cancelled",
      payload: {},
    });
    const continuationId = await createPendingSteeringRun(tx, run);
    return { seq: event.seq, continuationId };
  });
  if (!cancelled) return true;
  await deps.events.notify(run.threadId, cancelled.seq).catch(() => undefined);
  if (cancelled.continuationId) await wakeRun(deps.jobs, cancelled.continuationId);
  return true;
}
