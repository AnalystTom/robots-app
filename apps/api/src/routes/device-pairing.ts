import { ORPCError } from "@orpc/server";
import type { PairedDevice } from "@robots/contracts";
import type { PrismaClient } from "@robots/db";
import type { RouterContext } from "./context.js";

const PAIRED_DEVICES_MAX = 100;

/** The account's live sign-ins made with a pairing code, newest activity first. */
export async function listPairedDevices(
  prisma: Pick<PrismaClient, "session">,
  userId: string,
  currentSessionId: string | undefined,
  now = new Date(),
): Promise<PairedDevice[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, pairedDevice: { not: null }, expiresAt: { gt: now } },
    orderBy: { updatedAt: "desc" },
    take: PAIRED_DEVICES_MAX,
    select: {
      id: true,
      pairedDevice: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return sessions.map((session) => ({
    id: session.id,
    name: session.pairedDevice ?? "",
    userAgent: session.userAgent || null,
    ipAddress: session.ipAddress || null,
    pairedAt: session.createdAt.toISOString(),
    lastSeenAt: session.updatedAt.toISOString(),
    current: session.id === currentSessionId,
  }));
}

/**
 * Pairing codes and the devices they signed in. The exchange itself is an auth endpoint
 * (`/api/auth/pairing/exchange`), since it answers a device that has no session yet.
 */
export function devicePairingRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  /** Tokens of the user's paired sessions matching `where`; tokens never leave this module. */
  const pairedTokens = async (userId: string, where: { id?: string; notId?: string }) =>
    (
      await deps.prisma.session.findMany({
        where: {
          userId,
          pairedDevice: { not: null },
          ...(where.id ? { id: where.id } : {}),
          ...(where.notId ? { id: { not: where.notId } } : {}),
        },
        select: { token: true },
      })
    ).map((session) => session.token);
  return {
    devicePairing: {
      create: authed.devicePairing.create.handler(async ({ context }) => {
        const { code, expiresAt } = await deps.auth.issuePairingCode(context.actor.userId);
        return { code, expiresAt: expiresAt.toISOString() };
      }),
      devices: authed.devicePairing.devices.handler(({ context }) =>
        listPairedDevices(deps.prisma, context.actor.userId, context.sessionId),
      ),
      revoke: authed.devicePairing.revoke.handler(async ({ context, input }) => {
        const tokens = await pairedTokens(context.actor.userId, { id: input.id });
        if (!tokens.length) throw new ORPCError("NOT_FOUND");
        await deps.auth.endSessions(tokens);
        return { ok: true as const };
      }),
      revokeOthers: authed.devicePairing.revokeOthers.handler(async ({ context }) => {
        const tokens = await pairedTokens(context.actor.userId, { notId: context.sessionId });
        await deps.auth.endSessions(tokens);
        return { revoked: tokens.length };
      }),
    },
  };
}
