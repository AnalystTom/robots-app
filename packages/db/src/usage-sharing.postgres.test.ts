import type { AnalyticsEvent } from "@robots/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem } from "./row-security.js";
import { onlyWhereUsageSharingIsOn, rememberUsageSharing } from "./usage-sharing.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

describePostgres("product analytics gated by usage sharing (PostgreSQL)", () => {
  const provider = "sendblue";
  const suffix = Math.floor(Math.random() * 9_000_000 + 1_000_000);
  const addresses = [`+1556${suffix}`, `+1557${suffix}`];
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let sharing: string;
  let silent: string;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const provision = (address: string) =>
      runAsSystem("test fixture", () =>
        provisionMessagingIdentity(
          prisma,
          { provider, address },
          { signupsEnabled: undefined, signupAllowlist: undefined },
        ),
      );
    sharing = (await provision(addresses[0]!)).userId;
    silent = (await provision(addresses[1]!)).userId;
    await asSystem(prisma).user.update({
      where: { id: sharing },
      data: { usageSharing: true, usageSharingAnsweredAt: new Date() },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await asSystem(prisma, "test fixture cleanup").messagingIdentity.deleteMany({
        where: { provider, address: { in: addresses } },
      });
      await close();
    }
  });

  it("forwards events only for users who turned sharing on", async () => {
    const forwarded: Array<{ userId: string; event: AnalyticsEvent }> = [];
    const analytics = onlyWhereUsageSharingIsOn(
      {
        capture: (userId, event) => void forwarded.push({ userId, event }),
        flush: async () => {},
      },
      prisma,
    )!;

    analytics.capture(silent, { name: "signed_in" });
    analytics.capture(sharing, { name: "signed_in" });
    analytics.capture("no-such-user", { name: "signed_in" });
    await analytics.flush();

    expect(forwarded).toEqual([{ userId: sharing, event: { name: "signed_in" } }]);
  });

  it("starts every new account with sharing off and no answer", async () => {
    const user = await asSystem(prisma).user.findUniqueOrThrow({
      where: { id: silent },
      select: { usageSharing: true, usageSharingAnsweredAt: true },
    });
    expect(user).toEqual({ usageSharing: false, usageSharingAnsweredAt: null });
  });

  it("stops forwarding as soon as the user turns sharing off", async () => {
    const forwarded: string[] = [];
    const analytics = onlyWhereUsageSharingIsOn(
      { capture: (userId) => void forwarded.push(userId), flush: async () => {} },
      prisma,
    )!;
    analytics.capture(sharing, { name: "signed_in" });
    await analytics.flush();
    expect(forwarded).toEqual([sharing]);

    await asSystem(prisma).user.update({ where: { id: sharing }, data: { usageSharing: false } });
    rememberUsageSharing(sharing, false);

    analytics.capture(sharing, { name: "signed_in" });
    await analytics.flush();

    expect(forwarded).toEqual([sharing]);
  });
});
