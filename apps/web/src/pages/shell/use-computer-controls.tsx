import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, ComputerReleaseReason, Me, Run, ThreadSnapshot } from "@robots/contracts";
import { isComputerAllowanceUsed } from "@robots/contracts";
import {
  COMPUTER_CONTROL_HEARTBEAT_MS,
  COMPUTER_HEARTBEAT_MS,
  isRetryableError,
} from "@robots/core";
import { Button, Spinner } from "@robots/ui-web";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ComputerMaintenanceActions } from "../../components/ComputerMaintenanceActions";
import { computersAreUnavailable } from "../../components/ComputersUnavailableHint";
import { bootComputerOnce, embeddableScreenUrl } from "../../lib/computer-screen";
import type { Panel } from "../../lib/right-panel-state";
import type { createSpaceRpc } from "../../lib/rpc";
import {
  computerBusyWithRun,
  computerPanelNeedsScreen,
  screenMissing,
  userHoldsComputerControl,
} from "../../lib/thread-events";
import { errorText } from "../../lib/user-error";
import type { ComputerState } from "./use-computer";

export function useComputerControls({
  rpc,
  state,
  panel,
  active,
  bots,
  botsRef,
  activeBotId,
  activeGroupId,
  runStatus,
  sandboxProvider,
  refreshThread,
  refreshGroupThread,
  onUpgrade,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  state: ComputerState;
  panel: Panel;
  active: Bot | undefined;
  bots: Bot[];
  botsRef: RefObject<Bot[]>;
  activeBotId: RefObject<string | undefined>;
  activeGroupId: RefObject<string | undefined>;
  runStatus: Run["status"] | undefined;
  sandboxProvider: Me["sandboxProvider"] | undefined;
  refreshThread: (
    botId: string,
    signal?: AbortSignal,
    options?: { readScreen?: boolean },
  ) => Promise<ThreadSnapshot>;
  refreshGroupThread: (groupId: string) => Promise<ThreadSnapshot>;
  onUpgrade: () => void;
}) {
  const { t } = useLingui();
  const {
    computer,
    commitComputer,
    computerCacheRef,
    cacheComputerFor,
    setBootingBotId,
    booting,
    bootsInFlight,
    screenUrl,
    setScreenUrl,
    screenUrlLoadedBotId,
    setScreenUrlLoadedBotId,
    computerOpen,
    setComputerOpen,
    computerBotId,
    setComputerBotId,
    computerOpenRef,
    computerBotIdRef,
    computerRef,
    computerError,
    setComputerError,
    computerErrorFromScreen,
    setComputerErrorFromScreen,
    screenLoadError,
    setScreenLoadError,
    screenAwaitsRetry,
    resetScreenReconnect,
    computerVisible,
    refreshComputerScreen,
    refreshOwnControlScreen,
    ownControlLease,
    expectOwnAnswer,
    expectOwnControlEvent,
    forgetOwnControlEvent,
  } = state;
  const [keepComputerRecovery, setKeepComputerRecovery] = useState(false);
  const recoveryHoldTimer = useRef<number | undefined>(undefined);
  const showComputerRecoveryHint = computersAreUnavailable(sandboxProvider) || keepComputerRecovery;
  const releaseComputerRecovery = useCallback(() => {
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = undefined;
    setKeepComputerRecovery(false);
  }, []);
  const holdComputerRecovery = useCallback(() => {
    setKeepComputerRecovery(true);
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = window.setTimeout(() => {
      recoveryHoldTimer.current = undefined;
      setKeepComputerRecovery(false);
    }, 4000);
  }, []);
  useEffect(() => {
    if (panel !== "computer") releaseComputerRecovery();
  }, [panel, releaseComputerRecovery]);
  useEffect(() => () => window.clearTimeout(recoveryHoldTimer.current), []);
  const computerBot =
    (computerBotId ? bots.find((bot) => bot.id === computerBotId) : undefined) ?? active;
  useEffect(() => {
    setScreenLoadError(null);
  }, [computerBot?.id, screenUrl]);
  const computerBootEpoch = useRef(0);
  const controlRequests = useRef(new Set<string>());
  const autoBooted = useRef<string | null>(null);

  async function bootComputer({
    botId: targetBotId,
    takeControl,
    showProgress,
    force = false,
  }: {
    botId: string;
    takeControl: boolean;
    showProgress: boolean;
    force?: boolean;
  }) {
    if (takeControl && controlRequests.current.has(targetBotId)) return;
    if (takeControl) controlRequests.current.add(targetBotId);
    setScreenUrlLoadedBotId(null);
    screenAwaitsRetry.current = false;
    const epoch = ++computerBootEpoch.current;
    const stillThisBoot = () => computerBootEpoch.current === epoch;
    const stillThisBot = () =>
      computerBotIdRef.current === targetBotId || activeBotId.current === targetBotId;
    const cached = computerCacheRef.current.get(targetBotId);
    const targetComputer = computer?.botId === targetBotId ? computer : (cached?.computer ?? null);
    const targetScreen = computer?.botId === targetBotId ? screenUrl : (cached?.screenUrl ?? null);
    const needsBoot = force || targetComputer?.state !== "running" || !targetScreen;
    if (showProgress && needsBoot) setBootingBotId(targetBotId);
    setComputerError(null);
    setComputerErrorFromScreen(false);
    try {
      if (needsBoot) {
        const status = await bootComputerOnce(bootsInFlight.current, targetBotId, () =>
          rpc.computer.boot({ botId: targetBotId }),
        );
        if (!stillThisBoot() || !stillThisBot()) return;
        if (status) {
          commitComputer(status);
          cacheComputerFor(targetBotId, { computer: status });
        }
      }
      if (takeControl) {
        expectOwnControlEvent(targetBotId, "computer.takeover.granted");
        const { leaseId } = await rpc.computer
          .takeover({ botId: targetBotId })
          .catch(async (error) => {
            await forgetOwnControlEvent(targetBotId);
            throw error;
          });
        expectOwnControlEvent(targetBotId, "computer.takeover.granted", leaseId);
        if (!stillThisBoot() || !stillThisBot()) return;
      }
      await (takeControl
        ? refreshAfterControlChange(targetBotId)
        : refreshComputerFor(targetBotId));
    } catch (error) {
      if (!stillThisBoot() || !stillThisBot()) return;
      setComputerError(
        errorText(error, takeControl ? t`Could not take control` : t`Computer failed to boot`),
      );
      setComputerErrorFromScreen(false);
      throw error;
    } finally {
      if (takeControl) controlRequests.current.delete(targetBotId);
      if (stillThisBoot()) setBootingBotId(null);
    }
  }

  async function refreshAfterControlChange(targetBotId: string) {
    const shown = activeBotId.current === targetBotId || computerBotIdRef.current === targetBotId;
    const screen = shown ? refreshOwnControlScreen(targetBotId).catch(() => null) : undefined;
    await refreshComputerFor(targetBotId, false).catch(() => undefined);
    await screen;
  }

  async function refreshComputerFor(targetBotId: string, readScreen = true) {
    if (activeBotId.current === targetBotId) {
      await refreshThread(targetBotId, undefined, { readScreen });
      return;
    }
    if (computerBotIdRef.current !== targetBotId) return;
    const status = await rpc.computer.status({ botId: targetBotId });
    if (computerBotIdRef.current !== targetBotId) return;
    commitComputer(status);
    cacheComputerFor(targetBotId, { computer: status });
    if (readScreen) await refreshComputerScreen(targetBotId);
  }

  useEffect(() => {
    if (panel !== "computer") {
      autoBooted.current = null;
      return;
    }
    if (!active) return;
    const botId = active.id;
    screenAwaitsRetry.current = false;
    let cancelled = false;
    void (async () => {
      const snap = await refreshThread(botId).catch(() => null);
      if (cancelled || activeBotId.current !== botId) return;
      const state = snap?.computer?.state;
      const screen = state === "running" ? await refreshComputerScreen(botId) : null;
      if (cancelled || activeBotId.current !== botId) return;
      if (!computerPanelNeedsScreen(state, screen) || autoBooted.current === botId) return;
      autoBooted.current = botId;
      await bootComputer({
        botId,
        takeControl: false,
        showProgress: false,
        force: true,
      }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, active?.id]);

  useEffect(() => {
    setComputerOpen(false);
    setComputerError(null);
    setComputerErrorFromScreen(false);
    setComputerBotId(active?.id);
  }, [active?.id]);

  useEffect(() => {
    if (!computer?.busyBotName) {
      setComputerError(null);
      setComputerErrorFromScreen(false);
    }
  }, [computer?.busyBotName]);

  const computerBlockedByRun = computerBusyWithRun(computer, runStatus);
  useEffect(() => {
    if (computerBlockedByRun) return;
    const botId = computer?.botId;
    if (!botId || !computerOpenRef.current || computerBotIdRef.current !== botId) return;
    if (activeBotId.current !== botId) return;
    if (computer.state !== "stopped" && computer.state !== "suspended") return;
    void bootComputer({
      botId,
      takeControl: false,
      showProgress: true,
      force: true,
    }).catch(() => undefined);
  }, [computerBlockedByRun]);

  useEffect(() => {
    if (!computerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229)
        setComputerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [computerOpen]);

  const hasControl = userHoldsComputerControl(computer, computerBot?.id);
  useEffect(() => {
    const heartbeatBotId = computerBot?.id ?? active?.id;
    if ((panel !== "computer" && !computerOpen) || !heartbeatBotId || computer?.state !== "running")
      return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void rpc.computer.heartbeat({ botId: heartbeatBotId }).catch((error) => {
        if (!isRetryableError(error)) window.clearInterval(timer);
      });
    };
    const timer = window.setInterval(
      ping,
      hasControl ? COMPUTER_CONTROL_HEARTBEAT_MS : COMPUTER_HEARTBEAT_MS,
    );
    ping();
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [panel, computerOpen, computerBot?.id, active?.id, computer?.state, hasControl]);

  const heldBotId = hasControl && computerOpen ? computerBot?.id : undefined;
  const heldLeaseId = heldBotId ? computer?.controlLeaseId : undefined;
  useEffect(() => {
    if (!heldBotId || !heldLeaseId) return;
    const handBack = () =>
      void rpc.computer
        .release({ botId: heldBotId, leaseId: heldLeaseId }, { context: { keepalive: true } })
        .catch(() => undefined);
    window.addEventListener("pagehide", handBack);
    return () => {
      window.removeEventListener("pagehide", handBack);
      handBack();
    };
  }, [heldBotId, heldLeaseId]);

  const controlBotNeedsRead =
    computer?.controlHolder === "user" && !computer.controlledByOther && !computer.controlLeaseId
      ? computer.botId
      : undefined;
  useEffect(() => {
    if (!controlBotNeedsRead || !computerOpen) return;
    void refreshComputerFor(controlBotNeedsRead, false).catch(() => undefined);
  }, [controlBotNeedsRead, computerOpen]);

  async function openComputer(botId?: string, takeControl = false) {
    const id = botId ?? active?.id;
    if (!id) return false;
    const bot = botsRef.current.find((candidate) => candidate.id === id);
    if (!bot) return false;
    computerBotIdRef.current = id;
    setComputerBotId(id);
    const cached = computerCacheRef.current.get(id);
    const targetComputer = computer?.botId === id ? computer : (cached?.computer ?? null);
    const targetScreen = computer?.botId === id ? screenUrl : (cached?.screenUrl ?? null);
    if (computer?.botId !== id) {
      setScreenUrlLoadedBotId(null);
      commitComputer(targetComputer);
      setScreenUrl(targetScreen);
    }
    const bootInFlight = bootsInFlight.current.has(id) || targetComputer?.state === "booting";
    setComputerOpen(true);
    computerVisible.current = true;
    if (bootInFlight && !takeControl) {
      if (!bootsInFlight.current.has(id)) await refreshComputerFor(id).catch(() => undefined);
      return true;
    }
    const needsTakeover = takeControl && !userHoldsComputerControl(targetComputer, id);
    try {
      await bootComputer({
        botId: id,
        takeControl: needsTakeover,
        showProgress: needsTakeover || targetComputer?.state !== "running",
        force: targetComputer?.state !== "running",
      });
      return true;
    } catch {
      return false;
    }
  }
  const openComputerRef = useRef(openComputer);
  openComputerRef.current = openComputer;
  const onOpenComputer = useCallback((botId?: string, takeControl?: boolean) => {
    void openComputerRef.current(botId, takeControl);
  }, []);

  async function releaseComputer(reason?: ComputerReleaseReason) {
    const botId = computerBotIdRef.current ?? activeBotId.current;
    if (!botId) return;
    try {
      const leaseId = computerRef.current?.controlLeaseId ?? ownControlLease(botId);
      if (leaseId) expectOwnControlEvent(botId, "computer.takeover.released", leaseId);
      if (reason !== undefined) expectOwnAnswer(botId);
      await rpc.computer.release({ botId, reason }).catch(async (error) => {
        await forgetOwnControlEvent(botId);
        throw error;
      });
      if (computerBotIdRef.current !== botId && activeBotId.current !== botId) return;
      await refreshAfterControlChange(botId).catch(() => undefined);
      const groupId = activeGroupId.current;
      if (groupId) {
        await refreshGroupThread(groupId).catch(() => undefined);
      }
    } catch {
      if (computerBotIdRef.current !== botId && activeBotId.current !== botId) return;
      setComputerError(t`Could not continue`);
      setComputerErrorFromScreen(false);
    }
  }

  async function answerTakeover(
    botId: string,
    runId: string | undefined,
    reason: ComputerReleaseReason,
  ) {
    const leaseId =
      computerRef.current?.botId === botId
        ? (computerRef.current.controlLeaseId ?? ownControlLease(botId))
        : ownControlLease(botId);
    if (leaseId) expectOwnControlEvent(botId, "computer.takeover.released", leaseId);
    expectOwnAnswer(botId);
    await rpc.computer.release({ botId, runId, reason }).catch(async (error) => {
      await forgetOwnControlEvent(botId);
      throw error;
    });
    const groupId = activeGroupId.current;
    await Promise.all([
      computerBotIdRef.current === botId || activeBotId.current === botId
        ? refreshAfterControlChange(botId).catch(() => undefined)
        : undefined,
      groupId ? refreshGroupThread(groupId).catch(() => undefined) : undefined,
    ]);
  }
  const answerTakeoverRef = useRef(answerTakeover);
  answerTakeoverRef.current = answerTakeover;
  const onReleaseComputer = useCallback(
    (botId: string, runId: string | undefined, reason: ComputerReleaseReason) =>
      answerTakeoverRef.current(botId, runId, reason),
    [],
  );

  const embeddedScreenUrl = embeddableScreenUrl(screenUrl);
  const hideScreenLoadError = computerErrorFromScreen && Boolean(embeddedScreenUrl);
  const screenFailure =
    Boolean(screenLoadError) ||
    Boolean(computerError && !hideScreenLoadError && computerErrorFromScreen) ||
    screenMissing({
      state: computer?.state,
      kind: computer?.kind,
      booting,
      screenUrlLoaded: Boolean(computerBot?.id && screenUrlLoadedBotId === computerBot.id),
      embeddedUrl: embeddedScreenUrl,
    });
  const computerFailure =
    computerError && !hideScreenLoadError
      ? computerError
      : (screenLoadError ??
        (screenFailure
          ? t`Could not connect to the computer screen`
          : !booting && computer?.state === "error"
            ? t`Computer failed to boot`
            : null));
  const allowanceUsed = computer?.state !== "running" && isComputerAllowanceUsed(computerFailure);
  const computerScreenError = computerFailure ? (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 text-center text-body">
      {screenFailure ? (
        <p>
          <Trans>Screen not connected</Trans>
        </p>
      ) : null}
      <p className="text-destructive">{computerFailure}</p>
      {allowanceUsed ? (
        <Button variant="outline" size="sm" onClick={onUpgrade}>
          <Trans>Upgrade</Trans>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!computerBot) return;
            setScreenLoadError(null);
            setScreenUrlLoadedBotId(null);
            screenAwaitsRetry.current = false;
            resetScreenReconnect();
            if (computer?.state === "running") {
              setComputerError(null);
              setComputerErrorFromScreen(false);
              void refreshComputerScreen(computerBot.id);
            } else
              void bootComputer({
                botId: computerBot.id,
                takeControl: false,
                showProgress: true,
                force: true,
              }).catch(() => undefined);
          }}
        >
          <Trans>Retry screen</Trans>
        </Button>
      )}
      {computerBot &&
      ((screenFailure && computer?.state === "running") ||
        (computer?.state === "error" && !allowanceUsed)) ? (
        <ComputerMaintenanceActions
          visibleRecover
          botId={computerBot.id}
          computer={computer}
          onChanged={async () => {
            await refreshComputerFor(computerBot.id);
          }}
        />
      ) : null}
    </div>
  ) : null;
  const computerBooting =
    booting || computer?.state === "booting" ? (
      <span className="flex flex-col items-center gap-3">
        <Spinner aria-hidden className="size-5 motion-reduce:animate-none" />
        {t`Booting live desktop…`}
      </span>
    ) : null;
  const computerPreviewScreen =
    !computerOpen &&
    computer?.state === "running" &&
    Boolean(embeddedScreenUrl) &&
    !computerScreenError;
  const showingRecoveryHint =
    !computerOpen &&
    computer?.kind !== "desktop" &&
    !computerPreviewScreen &&
    !computerScreenError &&
    showComputerRecoveryHint;

  return {
    computerBot,
    openComputer,
    onOpenComputer,
    onReleaseComputer,
    releaseComputer,
    refreshComputerFor,
    holdComputerRecovery,
    releaseComputerRecovery,
    showComputerRecoveryHint,
    showingRecoveryHint,
    embeddedScreenUrl,
    hasControl,
    computerScreenError,
    computerBooting,
  };
}
