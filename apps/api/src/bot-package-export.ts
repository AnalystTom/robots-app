import type { Actor, BotPackage } from "@robots/contracts";
import { resolveBotAvatarSet } from "@robots/contracts";
import { exportBotPackage } from "@robots/core";
import type { PrismaClient } from "@robots/db";
import { availableInSpace, IsolationError } from "@robots/db";

export async function exportBotPackageFor(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string; includeMemory: boolean },
  now?: Date,
): Promise<BotPackage> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  const bot = await prisma.bot.findFirst({
    where: { ...owner, id: input.botId, archivedAt: null },
    select: {
      name: true,
      description: true,
      instructions: true,
      color: true,
      avatarSet: true,
      modelProvider: true,
      modelId: true,
    },
  });
  if (!bot) throw new IsolationError();
  const [skills, routines, memory] = await Promise.all([
    prisma.agentSkill.findMany({
      where: { ...availableInSpace(actor), source: "user" },
      select: { content: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.routine.findMany({
      where: { ...owner, botId: input.botId },
      select: {
        name: true,
        prompt: true,
        crons: true,
        timezone: true,
        webhookEnabled: true,
        githubEnabled: true,
        messageProvider: true,
        emailSenders: true,
        watch: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    input.includeMemory
      ? prisma.memoryDocument.findMany({
          where: { ...owner, botId: input.botId, scope: "bot" },
          select: { path: true, content: true },
          orderBy: { path: "asc" },
        })
      : Promise.resolve([]),
  ]);
  return exportBotPackage(
    {
      bot: { ...bot, avatarSet: resolveBotAvatarSet(bot.avatarSet) },
      skills,
      routines,
      memory,
    },
    { includeMemory: input.includeMemory, now },
  );
}
