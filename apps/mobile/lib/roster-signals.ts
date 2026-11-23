import type { SpaceChangeKind } from "@robots/contracts";
import {
  abortableDelay,
  isRetryableError,
  reconnectDelayMs,
  streamRetryDelayMs,
} from "@robots/core";
import { useEffect, useRef } from "react";
import { subscribeSpaceSelection } from "./api";
import { subscribeRosterSignals } from "./api-live";
import { useAppForeground } from "./app-foreground";
import { computerUpdates } from "./computer-updates";
import { subscribeSessionGeneration } from "./session";

const rosterListeners = new Set<() => void>();
const spaceChangeListeners = new Set<(kind: SpaceChangeKind) => void>();
let holders = 0;
let close: (() => void) | undefined;

function followIdentity(listener: () => void): () => void {
  const unfollowSpace = subscribeSpaceSelection(listener);
  const unfollowSession = subscribeSessionGeneration(listener);
  return () => {
    unfollowSpace();
    unfollowSession();
  };
}

function nextIdentity(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      unfollow();
      signal.removeEventListener("abort", done);
      resolve();
    };
    const unfollow = followIdentity(done);
    signal.addEventListener("abort", done);
    if (signal.aborted) done();
  });
}

async function follow(signal: AbortSignal) {
  let retry = 0;
  while (!signal.aborted) {
    let failure: unknown;
    let opened = false;
    const connection = new AbortController();
    const abort = () => connection.abort();
    signal.addEventListener("abort", abort);
    const unfollowIdentity = followIdentity(abort);
    try {
      await subscribeRosterSignals(
        () => {
          if (connection.signal.aborted) return;
          opened = true;
          for (const listener of rosterListeners) listener();
        },
        connection.signal,
        (kind) => {
          if (connection.signal.aborted) return;
          if (kind === "computerUpdates") computerUpdates.signalled();
          else for (const listener of spaceChangeListeners) listener(kind);
        },
      );
    } catch (error) {
      failure = error;
    }
    unfollowIdentity();
    signal.removeEventListener("abort", abort);
    if (signal.aborted) return;
    if (connection.signal.aborted) continue;
    if (failure !== undefined && !isRetryableError(failure)) {
      await nextIdentity(signal);
      retry = 0;
      continue;
    }
    if (opened) retry = 0;
    await abortableDelay(
      opened ? reconnectDelayMs(failure) : streamRetryDelayMs(failure, retry++),
      signal,
    );
  }
}

function hold(): () => void {
  if (holders++ === 0) {
    const controller = new AbortController();
    void follow(controller.signal);
    close = () => controller.abort();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders > 0) return;
    close?.();
    close = undefined;
  };
}

export function useLiveStream(enabled: boolean): void {
  const foreground = useAppForeground();
  useEffect(() => (enabled && foreground ? hold() : undefined), [enabled, foreground]);
}

export function useRosterSignals(read: () => unknown, enabled: boolean): void {
  useLiveStream(enabled);
  const foreground = useAppForeground();
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!enabled || !foreground) return;
    const listener = () => void readRef.current();
    listener();
    rosterListeners.add(listener);
    return () => {
      rosterListeners.delete(listener);
    };
  }, [enabled, foreground]);
}

export function useSpaceChanges(
  kind: Exclude<SpaceChangeKind, "computerUpdates">,
  onChange: () => unknown,
  enabled: boolean,
): void {
  useLiveStream(enabled);
  const foreground = useAppForeground();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    const listener = (changed: SpaceChangeKind) => {
      if (changed === kind) void onChangeRef.current();
    };
    spaceChangeListeners.add(listener);
    return () => {
      spaceChangeListeners.delete(listener);
    };
  }, [kind, enabled]);
  const wasForeground = useRef(foreground);
  useEffect(() => {
    if (enabled && foreground && !wasForeground.current) void onChangeRef.current();
    wasForeground.current = foreground;
  }, [enabled, foreground]);
}
