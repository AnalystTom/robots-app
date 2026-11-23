import type { ProductAnalytics } from "@robots/adapter-kit";
import { bestEffort } from "@robots/logging";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

export function onlyWhereUsageSharingIsOn(
  analytics: ProductAnalytics | undefined,
  prisma: PrismaClient,
): ProductAnalytics | undefined {
  if (!analytics) return undefined;
  const checking = new Set<Promise<unknown>>();
  return {
    capture(userId, event, identity, experiments) {
      const check = bestEffort(
        "check whether the user shares usage data",
        runAsSystem("check whether the user shares usage data", () =>
          prisma.user.findUnique({ where: { id: userId }, select: { usageSharing: true } }),
        ).then((user) => {
          if (user?.usageSharing) analytics.capture(userId, event, identity, experiments);
        }),
      ).finally(() => checking.delete(check));
      checking.add(check);
    },
    async flush() {
      await Promise.all(checking);
      await analytics.flush();
    },
  };
}
