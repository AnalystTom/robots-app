import type { ProductAnalytics } from "@robots/adapter-kit";
import { bestEffort } from "@robots/logging";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

const SHARING_TTL_MS = 30_000;
const MAX_CACHED_USERS = 1000;
const MAX_IN_FLIGHT_CHECKS = 1000;

const cachedSharing = new Map<string, { on: Promise<boolean>; expiresAt: number }>();

function storeSharing(userId: string, on: Promise<boolean>): void {
  cachedSharing.delete(userId);
  cachedSharing.set(userId, { on, expiresAt: Date.now() + SHARING_TTL_MS });
  if (cachedSharing.size > MAX_CACHED_USERS) {
    const oldest = cachedSharing.keys().next().value;
    if (oldest !== undefined) cachedSharing.delete(oldest);
  }
}

export function rememberUsageSharing(userId: string, usageSharing: boolean): void {
  storeSharing(userId, Promise.resolve(usageSharing));
}

export function onlyWhereUsageSharingIsOn(
  analytics: ProductAnalytics | undefined,
  prisma: PrismaClient,
): ProductAnalytics | undefined {
  if (!analytics) return undefined;
  const checking = new Set<Promise<unknown>>();

  function sharesUsage(userId: string): Promise<boolean> {
    const cached = cachedSharing.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.on;
    const on = runAsSystem("check whether the user shares usage data", () =>
      prisma.user.findUnique({ where: { id: userId }, select: { usageSharing: true } }),
    ).then(
      (user) => Boolean(user?.usageSharing),
      (error: unknown) => {
        cachedSharing.delete(userId);
        throw error;
      },
    );
    storeSharing(userId, on);
    return on;
  }

  return {
    capture(userId, event, identity, experiments) {
      if (checking.size >= MAX_IN_FLIGHT_CHECKS) return;
      const check = bestEffort(
        "check whether the user shares usage data",
        sharesUsage(userId).then((on) => {
          if (on) analytics.capture(userId, event, identity, experiments);
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
