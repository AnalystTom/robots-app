// @vitest-environment jsdom
import { RECONNECT_SPREAD_MS } from "@robots/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followStream } from "./follow-stream";

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

async function* endedStream<T>(...values: T[]): AsyncIterable<T> {
  yield* values;
}

describe("followStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("backs off further each time the stream cannot open, up to half a minute", async () => {
    const open = vi.fn(offline);
    const stop = followStream(open, () => {});
    const opensAfter = async (ms: number) => {
      const before = open.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(open).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(open).toHaveBeenCalledTimes(before + 1);
    };
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    for (const ms of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) await opensAfter(ms);
    stop();
  });

  it("starts the backoff over once the stream opens", async () => {
    let attempt = 0;
    const open = vi.fn(async () => {
      attempt += 1;
      if (attempt === 3) return endedStream("hello");
      throw new TypeError("Failed to fetch");
    });
    const onFrame = vi.fn();
    const stop = followStream(open, onFrame);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    expect(open).toHaveBeenCalledTimes(3);
    expect(onFrame).toHaveBeenCalledWith("hello");
    await vi.advanceTimersByTimeAsync(RECONNECT_SPREAD_MS);
    expect(open).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(open).toHaveBeenCalledTimes(5);
    stop();
  });

  it("retries at once when the browser comes back online or regains focus", async () => {
    const open = vi.fn(offline);
    const stop = followStream(open, () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    expect(open).toHaveBeenCalledTimes(4);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(open).toHaveBeenCalledTimes(6);

    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(7);
    stop();
  });

  it("keeps the wait the server asked for when the browser regains focus", async () => {
    const open = vi.fn(() =>
      Promise.reject(Object.assign(new Error("busy"), { status: 503, retryAfterMs: 20_000 })),
    );
    const stop = followStream(open, () => {});
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(open).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports each failed attempt before deciding whether to retry", async () => {
    const busy = Object.assign(new Error("busy"), { status: 503 });
    const open = vi.fn(() => Promise.reject(busy));
    const onFailure = vi.fn();
    const stop = followStream(open, () => {}, undefined, onFailure);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenLastCalledWith(busy);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onFailure).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops listening for online and focus once stopped or refused", async () => {
    const open = vi.fn(() => Promise.reject(Object.assign(new Error("gone"), { status: 401 })));
    const onRefused = vi.fn();
    followStream(open, () => {}, onRefused);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRefused).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(open).toHaveBeenCalledOnce();

    const stopped = vi.fn(offline);
    const stop = followStream(stopped, () => {});
    await vi.advanceTimersByTimeAsync(0);
    stop();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopped).toHaveBeenCalledOnce();
  });
});
