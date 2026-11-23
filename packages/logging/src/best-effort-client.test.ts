import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestEffort } from "./best-effort-client.js";

describe("bestEffort for clients", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("resolves to the value and warns nothing when the work succeeds", async () => {
    await expect(bestEffort("read the cache", Promise.resolve("hit"))).resolves.toBe("hit");
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves to undefined and warns once with the label and error when the work fails", async () => {
    const failure = new Error("network down");
    await expect(
      bestEffort("open store listing", Promise.reject(failure)),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("best effort failed: open store listing", failure);
  });

  it("resolves to undefined without warning when the work was aborted", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(
      bestEffort("check over-the-air update", Promise.reject(aborted)),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
