import { isRetryableError, reconnectDelayMs, retryDelayMs, streamRetryDelayMs } from "@robots/core";

const RECONNECT_NOW_EVENTS = ["online", "focus"] as const;

/**
 * Follows a server stream until stopped: reconnects after it drops, backs off while it cannot
 * open, retries at once when the browser comes back online or regains focus, and gives up on a
 * refusal, calling `onRefused`. Returns the stop function.
 */
export function followStream<T>(
  open: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  onFrame: (frame: T) => void,
  onRefused?: () => void,
): () => void {
  let active = true;
  let controller: AbortController | undefined;
  let cancelRetry: (() => void) | undefined;
  let retry = 0;
  let serverAskedToWait = false;
  const reconnectNow = () => {
    if (serverAskedToWait) return;
    retry = 0;
    cancelRetry?.();
  };
  const host = typeof window === "undefined" ? undefined : window;
  for (const event of RECONNECT_NOW_EVENTS) host?.addEventListener(event, reconnectNow);
  const stop = () => {
    active = false;
    for (const event of RECONNECT_NOW_EVENTS) host?.removeEventListener(event, reconnectNow);
    controller?.abort();
    cancelRetry?.();
  };
  void (async () => {
    while (active) {
      controller = new AbortController();
      let failure: unknown;
      let opened = false;
      try {
        const stream = await open(controller.signal);
        opened = true;
        retry = 0;
        for await (const frame of stream) {
          if (!active) return;
          onFrame(frame);
        }
      } catch (cause) {
        failure = cause;
      } finally {
        controller.abort();
      }
      if (!active) return;
      if (failure !== undefined && !isRetryableError(failure)) {
        onRefused?.();
        stop();
        return;
      }
      serverAskedToWait = retryDelayMs(failure, 0) > 0;
      const delay = opened ? reconnectDelayMs(failure) : streamRetryDelayMs(failure, retry++);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        cancelRetry = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      cancelRetry = undefined;
    }
  })();
  return stop;
}
