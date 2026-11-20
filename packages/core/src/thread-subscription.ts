import type { ProductEvent } from "@robots/contracts";
import { abortableDelay } from "./async.js";
import {
  isRetryableError,
  reconnectDelayMs,
  retryDelayMs,
  streamRetryDelayMs,
} from "./retry-policy.js";

type ThreadHead = { threadId: string; cursor: number };
type SnapshotRecovery =
  | { phase: "snapshot" }
  | { phase: "replay"; projectionFloor: number; readonly suppressEffectsThrough: number }
  | { phase: "live" };

export const IDLE_TIMEOUT_MS = 45_000;

export async function runThreadSubscription(options: {
  signal: AbortSignal;
  loadInitial: () => Promise<ThreadHead | null>;
  loadHead: () => Promise<ThreadHead | null>;
  refresh: () => Promise<unknown>;
  currentSnapshot: () => ThreadHead | null;
  subscribe: (cursor: number, signal: AbortSignal) => Promise<AsyncIterable<ProductEvent>>;
  beforeEvent?: (event: ProductEvent) => void;
  applyEvent: (event: ProductEvent) => void;
  onEvent: (event: ProductEvent, initial: ThreadHead) => void;
  random?: () => number;
}): Promise<void> {
  const { signal, random = Math.random } = options;
  const stopped = Symbol("stopped");
  let refused = false;
  let lastFailure: unknown;
  const isStopped = () => signal.aborted || refused;
  const snapshotAbort = new AbortController();
  let activeAttempt: AbortController | undefined;
  const untilAborted = async <T>(
    work: Promise<T>,
    abort: AbortSignal,
  ): Promise<T | typeof stopped> => {
    let onAbort!: () => void;
    const cancelled = new Promise<typeof stopped>((resolve) => {
      onAbort = () => resolve(stopped);
      abort.addEventListener("abort", onAbort, { once: true });
      if (abort.aborted) onAbort();
    });
    try {
      return await Promise.race([work, cancelled]);
    } finally {
      abort.removeEventListener("abort", onAbort);
    }
  };
  const onAbort = () => {
    activeAttempt?.abort(signal.reason);
    snapshotAbort.abort(signal.reason);
  };
  const noteFailure = (error: unknown) => {
    if (retryDelayMs(error, 0) >= retryDelayMs(lastFailure, 0)) lastFailure = error;
    if (!isRetryableError(error)) {
      refused = true;
      onAbort();
    }
    return null;
  };
  const wait = async (delay: number, abort: AbortSignal) => {
    lastFailure = undefined;
    await abortableDelay(delay, abort);
    return !isStopped() && !abort.aborted;
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  let snapshotTask: Promise<void> | undefined;
  try {
    if (isStopped()) return;
    let initial = await untilAborted(options.loadInitial().catch(noteFailure), signal);
    if (initial === stopped || isStopped()) return;
    let headRetryMs = 250;
    while (!initial && !isStopped()) {
      initial = await untilAborted(options.loadHead().catch(noteFailure), signal);
      if (initial === stopped || isStopped()) return;
      if (initial) break;
      if (!(await wait(retryDelayMs(lastFailure, headRetryMs, random), signal))) return;
      headRetryMs = Math.min(headRetryMs * 2, 5_000);
    }
    if (!initial || isStopped()) return;
    const head = initial;
    let cursor = head.cursor;
    let effectsCursor = head.cursor;
    let generation = 0;
    const shown = options.currentSnapshot();
    const recovery: { current: SnapshotRecovery } = {
      current:
        shown?.threadId === head.threadId && shown.cursor >= head.cursor
          ? { phase: "live" }
          : { phase: "snapshot" },
    };
    const commitRecovery = () => {
      if (isStopped() || recovery.current.phase !== "snapshot") return;
      const committed = options.currentSnapshot();
      if (committed?.threadId !== head.threadId) return;
      recovery.current = {
        phase: "replay",
        projectionFloor: committed.cursor,
        suppressEffectsThrough: effectsCursor,
      };
      cursor = Math.min(committed.cursor, effectsCursor);
      generation += 1;
      activeAttempt?.abort();
      snapshotAbort.abort();
    };
    if (recovery.current.phase === "snapshot") {
      snapshotTask = (async () => {
        let snapshotRetryMs = 250;
        while (!snapshotAbort.signal.aborted) {
          if (
            !(await wait(retryDelayMs(lastFailure, snapshotRetryMs, random), snapshotAbort.signal))
          )
            return;
          await untilAborted(options.refresh().catch(noteFailure), snapshotAbort.signal);
          if (snapshotAbort.signal.aborted) return;
          commitRecovery();
          snapshotRetryMs = Math.min(snapshotRetryMs * 2, 5_000);
        }
      })();
    }
    let streamRetry = 0;
    while (!isStopped()) {
      const attempt = new AbortController();
      activeAttempt = attempt;
      const attemptGeneration = ++generation;
      let opened = false;
      try {
        const events = await untilAborted(
          options.subscribe(cursor, attempt.signal),
          attempt.signal,
        );
        if (events === stopped || isStopped() || generation !== attemptGeneration) continue;
        opened = true;
        streamRetry = 0;
        const iterator = events[Symbol.asyncIterator]();
        try {
          let pending: Promise<IteratorResult<ProductEvent>> | undefined;
          while (!isStopped()) {
            pending ??= iterator.next();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const next = await untilAborted(
              Promise.race([
                pending,
                new Promise<"idle">((resolve) => {
                  timer = setTimeout(() => resolve("idle"), IDLE_TIMEOUT_MS);
                }),
              ]),
              attempt.signal,
            ).finally(() => clearTimeout(timer));
            if (
              isStopped() ||
              generation !== attemptGeneration ||
              next === stopped ||
              next === "idle" ||
              next.done
            )
              break;
            pending = undefined;
            const event = next.value;
            if (event.type === "heartbeat") continue;
            cursor = Math.max(cursor, event.seq);
            const replay = recovery.current.phase === "replay" ? recovery.current : null;
            const deliverEffects = !replay || event.seq > replay.suppressEffectsThrough;
            if (deliverEffects) options.beforeEvent?.(event);
            const snapshot = options.currentSnapshot();
            if (replay && snapshot?.threadId === head.threadId) {
              replay.projectionFloor = Math.max(replay.projectionFloor, snapshot.cursor);
            }
            if (
              recovery.current.phase !== "snapshot" &&
              snapshot?.threadId === event.threadId &&
              (!replay || event.seq > replay.projectionFloor)
            ) {
              options.applyEvent(event);
            }
            if (deliverEffects) {
              options.onEvent(event, head);
              effectsCursor = Math.max(effectsCursor, event.seq);
            }
            if (
              replay &&
              event.seq >= Math.max(replay.projectionFloor, replay.suppressEffectsThrough)
            ) {
              recovery.current = { phase: "live" };
            }
          }
        } finally {
          attempt.abort();
          void iterator.return?.(undefined).catch(() => {});
        }
      } catch (error) {
        noteFailure(error);
      } finally {
        attempt.abort();
        activeAttempt = undefined;
      }
      if (isStopped()) return;
      if (generation !== attemptGeneration) continue;
      const reconnect = new AbortController();
      activeAttempt = reconnect;
      try {
        const spread = opened ? reconnectDelayMs(lastFailure, random) : 0;
        if (spread > 0) {
          lastFailure = undefined;
          await abortableDelay(spread, reconnect.signal);
          if (isStopped()) return;
          if (generation !== attemptGeneration) continue;
        }
        await untilAborted(options.refresh().catch(noteFailure), reconnect.signal);
        if (isStopped()) return;
        commitRecovery();
        if (generation !== attemptGeneration) continue;
        await wait(
          opened
            ? retryDelayMs(lastFailure, 250, random)
            : streamRetryDelayMs(lastFailure, streamRetry++, random),
          reconnect.signal,
        );
      } finally {
        reconnect.abort();
        activeAttempt = undefined;
      }
      if (isStopped()) return;
      if (generation !== attemptGeneration) continue;
    }
  } finally {
    activeAttempt?.abort();
    snapshotAbort.abort();
    signal.removeEventListener("abort", onAbort);
    await snapshotTask;
  }
}
