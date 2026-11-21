import { ComputerStatusSchema } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { resolveComputerWork, toComputerStatus } from "./computer-status.js";

type WorkPrisma = Parameters<typeof resolveComputerWork>[0];

function workWith(runStatus: string) {
  const prisma = {
    computerExecutionLease: {
      findUnique: async () => ({ runId: "run-1", expiresAt: new Date(Date.now() + 60_000) }),
    },
    run: {
      findUnique: async () => ({ status: runStatus }),
      findFirst: async () => null,
    },
  } as unknown as WorkPrisma;
  return resolveComputerWork(prisma, {
    computerId: "computer-1",
    botId: "bot-1",
    botName: "Writer",
  });
}

describe("resolveComputerWork", () => {
  it("shows the bot busy while its lease's run is still working", async () => {
    await expect(workWith("running")).resolves.toMatchObject({ busyBotName: "Writer" });
  });

  it("frees the computer once its run has completed, even while the lease row is still live", async () => {
    await expect(workWith("completed")).resolves.toMatchObject({ busyBotName: null });
  });
});

describe("toComputerStatus", () => {
  it("shows a quarantined computer as an error without making its screen available", () => {
    expect(
      toComputerStatus("bot", {
        kind: "novita",
        state: "quarantined",
        scope: "team",
        controlHolder: "none",
        homeRevision: "saved",
      }),
    ).toMatchObject({ state: "error", screenAvailable: false });
  });
  it("warns at 90% full until the user hides it, and again once the disk fills further", () => {
    const computer = {
      kind: "docker",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "saved",
      diskUsedBytes: 91n,
      diskFreeBytes: 9n,
    };
    const status = (changes: object) => toComputerStatus("bot", { ...computer, ...changes });
    expect(status({}).diskFullPercent).toBe(91);
    expect(ComputerStatusSchema.parse(status({})).diskFullPercent).toBe(91);
    expect(status({ diskUsedBytes: 89n, diskFreeBytes: 11n }).diskFullPercent).toBeUndefined();
    expect(status({ diskDismissedPercent: 91 }).diskFullPercent).toBeUndefined();
    expect(status({ diskDismissedPercent: 90 }).diskFullPercent).toBe(91);
    expect(status({ diskUsedBytes: null }).diskFullPercent).toBeUndefined();
  });
  it("passes through what the bot is doing with its computer", () => {
    const computer = {
      kind: "fake",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "revision-1",
    };
    expect(toComputerStatus("bot-1", computer)).toMatchObject({
      busyBotName: null,
      takeoverRequested: false,
    });
    expect(
      toComputerStatus("bot-1", computer, { busyBotName: "Writer", takeoverRequested: true }),
    ).toMatchObject({ busyBotName: "Writer", takeoverRequested: true });
  });

  it("tells only the person holding control their own lease", () => {
    const computer = {
      kind: "fake",
      state: "running",
      scope: "team",
      controlHolder: "user",
      controlBotId: "bot-1",
      controlLeaseId: "lease-1",
      controlUserId: "user-1",
      userId: "owner",
      homeRevision: "revision-1",
    };
    expect(toComputerStatus("bot-1", computer, undefined, true, "user-1").controlLeaseId).toBe(
      "lease-1",
    );
    // Another bot's screen on the same Team computer is not this lease's.
    expect(
      toComputerStatus("bot-2", computer, undefined, true, "user-1").controlLeaseId,
    ).toBeUndefined();
    const watcher = toComputerStatus("bot-1", computer, undefined, true, "user-2");
    expect(watcher.controlLeaseId).toBeUndefined();
    expect(watcher.controlledByOther).toBe(true);
  });

  it("sandbox-none-computer-status", () => {
    const stopped = toComputerStatus("bot-1", {
      kind: "none",
      state: "stopped",
      scope: "team",
      controlHolder: "none",
      homeRevision: "empty",
    });
    expect(ComputerStatusSchema.parse(stopped)).toMatchObject({
      kind: "none",
      state: "stopped",
      canUpdate: false,
      terminalAvailable: false,
      screenAvailable: false,
    });

    const running = toComputerStatus("bot-1", {
      kind: "none",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "empty",
    });
    expect(ComputerStatusSchema.parse(running)).toMatchObject({
      state: "stopped",
      canUpdate: false,
      terminalAvailable: false,
      screenAvailable: false,
    });
  });

  it.each(["boxd", "railway"])("offers the terminal on a %s computer", (kind) => {
    expect(
      toComputerStatus("bot-1", {
        kind,
        state: "running",
        scope: "team",
        controlHolder: "none",
        homeRevision: "r1",
      }).terminalAvailable,
    ).toBe(true);
  });

  it("hides update on desktop computers", () => {
    expect(
      toComputerStatus("bot-1", {
        kind: "desktop",
        state: "running",
        scope: "team",
        controlHolder: "none",
        homeRevision: "r1",
      }).canUpdate,
    ).toBe(false);
    expect(
      toComputerStatus("bot-1", {
        kind: "e2b",
        state: "running",
        scope: "team",
        controlHolder: "none",
        homeRevision: "r1",
      }).canUpdate,
    ).toBe(true);
  });
});
