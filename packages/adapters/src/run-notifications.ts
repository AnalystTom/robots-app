import type { NotificationMessage } from "@robots/adapter-kit";
import type { MessageBlock } from "@robots/contracts";
import {
  BACKGROUND_HELPER_TRIGGER,
  displayName,
  isBackgroundRunTrigger,
  plainTextFromMarkdown,
  redactSecrets,
  truncatedPlainText,
  truncatePlainText,
} from "@robots/core";
import type { PrismaClient, ThreadEvents } from "@robots/db";
import { countUnreadInboxChats, membersSnoozing } from "@robots/db";
import { getLogger } from "@robots/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { notificationIdentity } from "./notification-identity.js";
import { messageBlocksText } from "./run-replies.prompt.js";

const COMPLETION_NOTIFICATION_MAX_CHARS = 180;
const NOTIFY_RECIPIENTS_AT_ONCE = 5;

export async function runNotificationsEnabled(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
): Promise<boolean> {
  return (await runNotice(prisma, run)).enabled;
}

async function runNotice(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
  routineId?: string | null,
): Promise<{
  enabled: boolean;
  groupId: string | null;
  bot?: { id: string; name: string; color: string; avatarSet: string };
}> {
  const routine = routineId
    ? await prisma.routine.findUnique({ where: { id: routineId }, select: { notify: true } })
    : null;
  const source = await prisma.run.findFirst({
    where: {
      botId: run.botId,
      threadId: run.threadId,
      spaceId: run.spaceId,
      userId: run.userId,
    },
    select: {
      bot: { select: { id: true, name: true, color: true, avatarSet: true, notifyOnFinish: true } },
      thread: { select: { groupId: true } },
    },
  });
  if (!source) return { enabled: false, groupId: null };
  return {
    enabled: routine ? routine.notify : Boolean(source.thread.groupId || source.bot.notifyOnFinish),
    groupId: source.thread.groupId,
    bot: source.bot,
  };
}

export async function notifyRun(
  deps: ExecutorDeps,
  run: {
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    trigger: string;
    routineId?: string | null;
  },
  message: NotificationMessage,
  options: { retryOnFailure?: boolean } = {},
) {
  if (
    (!deps.notifications && !deps.events.publishChatAlert) ||
    (isBackgroundRunTrigger(run.trigger) && message.kind !== "help" && message.kind !== "takeover")
  )
    return;
  const routineId = message.kind === "failure" ? run.routineId : null;
  const notice = await runNotice(deps.prisma, run, routineId).catch((error) => {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification preference lookup", error);
    return null;
  });
  if (!notice?.enabled) return;
  const recipients =
    message.kind === "completion" && run.trigger !== "bot_message"
      ? await spaceMemberIds(deps.prisma, run.spaceId).catch((error) => {
          if (options.retryOnFailure) throw error;
          getLogger().error("notification recipients", error);
          return [run.userId];
        })
      : [run.userId];
  await deliverChatNotice(deps, {
    spaceId: run.spaceId,
    recipients,
    message,
    groupId: notice.groupId,
    bot: notice.bot,
    retryOnFailure: options.retryOnFailure,
  });
}

export async function notifyMemberMessage(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "notifications">,
  input: { spaceId: string; threadId: string; authorUserId: string; text: string },
) {
  if (!deps.notifications && !deps.events.publishChatAlert) return;
  const recipients = (await spaceMemberIds(deps.prisma, input.spaceId)).filter(
    (userId) => userId !== input.authorUserId,
  );
  if (!recipients.length) return;
  const [thread, author] = await Promise.all([
    deps.prisma.thread.findFirst({
      where: { id: input.threadId, spaceId: input.spaceId, externalConversationId: null },
      select: {
        bot: {
          select: { id: true, name: true, color: true, avatarSet: true, notifyOnFinish: true },
        },
        group: {
          select: {
            name: true,
            members: {
              orderBy: [{ createdAt: "asc" }, { botId: "asc" }],
              take: 1,
              select: { botId: true },
            },
          },
        },
        groupId: true,
      },
    }),
    deps.prisma.user.findUnique({ where: { id: input.authorUserId }, select: { name: true } }),
  ]);
  const botId = thread?.bot?.id ?? thread?.group?.members[0]?.botId;
  if (!thread || !botId || (!thread.groupId && !thread.bot?.notifyOnFinish)) return;
  const chatName = thread.group?.name ?? thread.bot?.name ?? "";
  const authorName = displayName(author?.name ?? "", "Someone");
  await deliverChatNotice(deps, {
    spaceId: input.spaceId,
    recipients,
    message: {
      kind: "completion",
      title: displayName(chatName, "Chat"),
      body: completionNotificationPreview(`${authorName}: ${input.text}`),
      botId,
      threadId: input.threadId,
    },
    groupId: thread.groupId,
    bot: thread.groupId ? undefined : (thread.bot ?? undefined),
  });
}

export async function usersPushing(
  prisma: PrismaClient,
  userIds: string[],
  retryOnFailure = false,
): Promise<Set<string>> {
  const rows = await prisma.user
    .findMany({
      where: { id: { in: userIds }, pushNotifications: true },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (retryOnFailure) throw error;
      getLogger().error("push setting lookup", error);
      return [];
    });
  return new Set(rows.map((row) => row.id));
}

async function spaceMemberIds(prisma: PrismaClient, spaceId: string): Promise<string[]> {
  const members = await prisma.spaceMember.findMany({
    where: { spaceId },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

async function deliverChatNotice(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "notifications">,
  input: {
    spaceId: string;
    recipients: string[];
    message: NotificationMessage;
    groupId: string | null;
    bot?: { id: string; name: string; color: string; avatarSet: string };
    retryOnFailure?: boolean;
  },
) {
  const { spaceId, message, groupId, bot } = input;
  const snoozing =
    message.kind === "completion"
      ? await membersSnoozing(deps.prisma, message.threadId, input.recipients).catch((error) => {
          if (input.retryOnFailure) throw error;
          getLogger().error("snoozed chat lookup", error);
          return new Set<string>();
        })
      : new Set<string>();
  const recipients = input.recipients.filter((userId) => !snoozing.has(userId));
  const notifications = deps.notifications;
  const pushing =
    notifications && recipients.length
      ? await usersPushing(deps.prisma, recipients, input.retryOnFailure)
      : new Set<string>();
  for (const userId of recipients) {
    publishChatAlert(deps.events, { spaceId, userId }, message, groupId);
  }
  if (!notifications || !recipients.length) return;
  const sender = bot && (await notificationIdentity(bot));
  const deliver = async (userId: string) => {
    if (!pushing.has(userId)) return;
    const badge = await countUnreadInboxChats(deps.prisma, { spaceId, userId }).catch((error) => {
      getLogger().error("unread chat count", error);
      return undefined;
    });
    return notifications
      .send(
        {
          ...message,
          ...(sender ? { sender } : {}),
          ...(groupId ? { groupId } : {}),
          ...(badge === undefined ? {} : { badge }),
        },
        {
          operationId: "notify",
          traceId: message.botId,
          spaceId,
          userId,
          botId: message.botId,
          signal: new AbortController().signal,
        },
      )
      .then(
        () => undefined,
        (error: unknown) => {
          getLogger().error("run notification", error);
          return { error };
        },
      );
  };
  const failures: Array<{ error: unknown } | undefined> = [];
  for (let start = 0; start < recipients.length; start += NOTIFY_RECIPIENTS_AT_ONCE) {
    const batch = recipients.slice(start, start + NOTIFY_RECIPIENTS_AT_ONCE);
    failures.push(...(await Promise.all(batch.map(deliver))));
  }
  const failed = failures.find((failure) => failure !== undefined);
  if (failed && input.retryOnFailure) throw failed.error;
}

export function publishChatAlert(
  events: Pick<ThreadEvents, "publishChatAlert"> | undefined,
  run: { spaceId: string; userId: string },
  message: NotificationMessage,
  groupId: string | null,
) {
  void (async () =>
    events?.publishChatAlert?.(run.userId, {
      kind: message.kind,
      title: truncatePlainText(message.title, COMPLETION_NOTIFICATION_MAX_CHARS),
      body: truncatePlainText(message.body, COMPLETION_NOTIFICATION_MAX_CHARS),
      spaceId: run.spaceId,
      botId: message.botId,
      threadId: message.threadId,
      ...(groupId ? { groupId } : {}),
    }))().catch((error) => getLogger().error("chat alert publish", error));
}

export function runSendsFinishNotification(trigger: string): boolean {
  return (
    trigger !== "created" &&
    trigger !== BACKGROUND_HELPER_TRIGGER &&
    !isBackgroundRunTrigger(trigger)
  );
}

export function completionNotificationBody(assembled: string, blocks: MessageBlock[]): string {
  if (assembled) return assembled;
  return messageBlocksText(blocks);
}

export function completionNotificationPreview(text: string): string {
  return truncatedPlainText(text, COMPLETION_NOTIFICATION_MAX_CHARS);
}

export function secretAskNotification(botName: string, label: string, runSecrets: string[]) {
  const text = plainTextFromMarkdown(redactSecrets(label, runSecrets), { maxSource: Infinity });
  const body = truncatePlainText(
    redactSecrets(text, runSecrets),
    COMPLETION_NOTIFICATION_MAX_CHARS,
  );
  return { title: `${botName} needs an answer`, body };
}

export function completionMarksUnread(
  trigger: string,
  text: string,
  userFacingPeerReply = false,
): boolean {
  if (trigger === "bot_message") return userFacingPeerReply;
  if (isBackgroundRunTrigger(trigger)) return false;
  return (trigger !== "routine" && trigger !== "reaction") || Boolean(text);
}

export function subagentMarksUnread(
  trigger: string,
  status: "running" | "completed" | "failed",
  userFacingPeerReply = false,
) {
  if (isBackgroundRunTrigger(trigger)) return false;
  return (
    status === "failed" ||
    (trigger === "bot_message" && userFacingPeerReply) ||
    (trigger !== "routine" && trigger !== "bot_message")
  );
}
