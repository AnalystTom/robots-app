import { beforeEach, describe, expect, it, vi } from "vitest";
import { bestEffort, installBestEffortSink } from "./best-effort-client.js";

describe("bestEffort for clients", () => {
  const sink = vi.fn<(message: string, error: unknown) => void>();

  beforeEach(() => {
    sink.mockClear();
    installBestEffortSink(sink);
  });

  it("resolves to the value and reports nothing when the work succeeds", async () => {
    await expect(bestEffort("read the cache", Promise.resolve("hit"))).resolves.toBe("hit");
    expect(sink).not.toHaveBeenCalled();
  });

  it("resolves to undefined and reports the label and error once when the work fails", async () => {
    const failure = new Error("network down");
    await expect(
      bestEffort("open store listing", Promise.reject(failure)),
    ).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("best effort failed: open store listing", failure);
  });

  it("resolves to undefined without reporting when the work was aborted", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(
      bestEffort("check over-the-air update", Promise.reject(aborted)),
    ).resolves.toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
  });
});
