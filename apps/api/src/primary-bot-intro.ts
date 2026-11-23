import { wakeRun } from "@robots/adapters";
import type { Actor, Bot, MessageBlock } from "@robots/contracts";
import { PRIMARY_BOT_SPAWN_KEY } from "@robots/contracts";
import { displayName } from "@robots/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@robots/db";
import type { RouterDeps } from "./router.js";
import { modelSetup } from "./routes/shared.js";

export function isPrimaryBot(bot: Pick<Bot, "spawnKey">): boolean {
  return bot.spawnKey === PRIMARY_BOT_SPAWN_KEY;
}

/** RoBot's first message, posted as soon as it exists so it greets even before a model is set. */
export function primaryBotGreeting(name: string, canLookAround: boolean): string {
  return [
    `Hey! I'm ${name}. I'm new here.`,
    "I'm here to be your primary bot. I can manage your other bots. Task me with anything. I'll make sure it gets to the right bot.",
    canLookAround
      ? "I'm taking a look around to see if there's anything I can pick up for you. I'll follow up in a moment."
      : "Once a model is connected in Settings → Models, I'll take a look around for anything I can pick up for you.",
  ].join("\n\n");
}

/** The hidden prompt for RoBot's first turn: look around the workspace, then offer one next step. */
export function primaryBotLookAroundPrompt(input: { userName: string }): string {
  const who = input.userName || "the user";
  return [
    `You were just set up as ${who}'s primary bot and have already introduced yourself. Do not greet again or repeat the introduction.`,
    `Look around this workspace for anything you can pick up for ${who}:`,
    "- Use list_fleet to see the other Bots, what each is for, and what they finished or left mid-flight.",
    "- If you have ticket tools, check open tasks, especially blocked ones or ones waiting on review.",
    "- Look at recent files, folders and documents the Bots made, and any live sources they track.",
    'As you go, post one short line before each new thing you check, saying what you are looking at next, such as "Looking at the Forkcast folder and a finished coding run next." Keep each line to one or two sentences.',
    "Finish with what you found in two or three sentences: name the concrete things, including numbers and goals they mention, and say plainly what is missing or empty.",
    "End with one concrete next step you could take, asked as a question with two options, such as doing it now or waiting for something from them first.",
    "If the workspace is still empty, say so in one line and offer to create a first specialist Bot for whatever they want done.",
    "Only look in this turn: do not start work, message or hand off to other Bots, or change anything until they answer.",
  ].join("\n");
}

/**
 * Starts RoBot instead of the usual creation intro: posts its greeting, then (with a model) queues
 * a first turn with its full tools to look around and follow up. An idempotent create that returns
 * an existing RoBot does nothing.
 */
export async function startPrimaryBot(deps: RouterDeps, actor: Actor, bot: Bot): Promise<void> {
  const threadId = bot.threadId;
  if (!threadId) return;
  // The scripted test runtime answers queued turns from a script; an extra run would steal one.
  const canLookAround =
    deps.env.agentRuntime !== "scripted" && !(await modelSetup(deps, actor)).needsModel;
  const user = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true },
  });
  const blocks: MessageBlock[] = [
    { kind: "text", text: primaryBotGreeting(bot.name, canLookAround) },
  ];
  const committed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
    const started =
      (await tx.message.findFirst({ where: { threadId }, select: { id: true } })) ??
      (await tx.run.findFirst({ where: { botId: bot.id }, select: { id: true } }));
    if (started) return null;
    const message = await createThreadMessageInTransaction(tx, { threadId, role: "bot", blocks });
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId,
      botId: bot.id,
      type: "thread.message.created",
      payload: { messageId: message.id, role: "bot", blocks },
    });
    if (!canLookAround) return { event, runId: null };
    const task = await tx.task.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        userId: actor.userId,
        prompt: primaryBotLookAroundPrompt({ userName: displayName(user?.name, "") }),
        status: "queued",
      },
    });
    const run = await tx.run.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        taskId: task.id,
        userId: actor.userId,
        status: "queued",
        trigger: "follow_up",
        sourceMessageId: message.id,
      },
      select: { id: true },
    });
    return { event, runId: run.id };
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (!committed) return;
  await deps.events.notify(threadId, committed.event.seq);
  if (committed.runId) await wakeRun(deps.jobs, committed.runId);
}
