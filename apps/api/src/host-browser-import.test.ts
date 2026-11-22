import { ORPCError } from "@orpc/server";
import { HostComputerAccessDeniedError, HostComputerRemoteError } from "@robots/adapters";
import { describe, expect, it } from "vitest";
import { refuseUnlessHostAdmin } from "./host-browser-import.js";

describe("refuseUnlessHostAdmin", () => {
  it("returns the host's answer", async () => {
    await expect(refuseUnlessHostAdmin(Promise.resolve("profiles"))).resolves.toBe("profiles");
  });

  it("refuses a non-admin, or a host without the method, as forbidden", async () => {
    await expect(
      refuseUnlessHostAdmin(Promise.reject(new HostComputerAccessDeniedError())),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(refuseUnlessHostAdmin(undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes a host's deliberate refusal through as a bad request", async () => {
    await expect(
      refuseUnlessHostAdmin(
        Promise.reject(new HostComputerRemoteError("Open the bot's screen first")),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Open the bot's screen first" });
  });

  it("keeps unexpected failures out of client errors", async () => {
    const failure = refuseUnlessHostAdmin(Promise.reject(new Error("fetch failed")));
    await expect(failure).rejects.toThrow("fetch failed");
    await expect(failure).rejects.not.toBeInstanceOf(ORPCError);
  });
});
