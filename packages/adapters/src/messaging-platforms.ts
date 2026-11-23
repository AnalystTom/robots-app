import { createHash } from "node:crypto";
import { TelegramAdapter, TelegramFormatConverter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter, WhatsAppAdapter, WhatsAppApiError } from "@chat-adapter/whatsapp";
import type { HttpInstance } from "@larksuiteoapi/node-sdk";
import type { MessagingInboundMessage, MessagingOutboundStatus } from "@robots/adapter-kit";
import { getLogger } from "@robots/logging";
import type { Adapter, AdapterPostableMessage, CardElement, Root } from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  isLinkNode,
  parseMarkdown,
  text,
  toPlainText,
  walkAst,
} from "chat";
import type { SendblueAdapterConfig, SendblueThreadId } from "chat-adapter-sendblue";
import type { ClientOptions as SendblueClientOptions } from "sendblue";
import type { MessagingPlatform } from "./chat-sdk-surface.js";
import { boundInboundMarkdown } from "./chat-sdk-surface.js";
import type { DiscordBotCredentials } from "./discord/adapter.js";
import {
  createDiscordAdapter,
  DISCORD_MESSAGE_LIMIT,
  discordBotFromEnv,
  isDiscordUndeliverable,
} from "./discord/adapter.js";
import { LazyLarkAdapter } from "./lark/lazy-adapter.js";
import { Domain } from "./lark/thread-id.js";
import { lazyChatAdapter } from "./lazy-chat-adapter.js";
import { splitMarkdown } from "./markdown-split.js";
import { LazyPhotonAdapter } from "./photon/lazy-adapter.js";
import { isVitestRuntime } from "./test-runtime.js";

export interface MessagingEnvironmentValues {
  apiUrl?: string | undefined;
  sendblueApiKeyId?: string | undefined;
  sendblueApiSecret?: string | undefined;
  sendblueSigningSecret?: string | undefined;
  sendbluePhoneNumber?: string | undefined;
  slackBotToken?: string | undefined;
  slackSigningSecret?: string | undefined;
  teamsAppId?: string | undefined;
  teamsAppPassword?: string | undefined;
  teamsAppTenantId?: string | undefined;
  whatsappAccessToken?: string | undefined;
  whatsappPhoneNumberId?: string | undefined;
  whatsappAppSecret?: string | undefined;
  whatsappVerifyToken?: string | undefined;
  telegramBotToken?: string | undefined;
  telegramWebhookSecret?: string | undefined;
  telegramBots?: TelegramBotCredentials[] | undefined;
  larkAppId?: string | undefined;
  larkAppSecret?: string | undefined;
  larkVerificationToken?: string | undefined;
  larkEncryptKey?: string | undefined;
  larkDomain?: string | undefined;
  photonProjectId?: string | undefined;
  photonProjectSecret?: string | undefined;
  photonWebhookSecret?: string | undefined;
  photonProjects?: PhotonProjectCredentials[] | undefined;
  discordBot?: DiscordBotCredentials | undefined;
}

export type { DiscordBotCredentials };
export { discordBotFromEnv };

export function messagingEnvFromProcess(
  env: Record<string, string | undefined>,
): MessagingEnvironmentValues {
  const clean = (value: string | undefined) => value?.trim() || undefined;
  return {
    apiUrl: clean(env.API_URL),
    sendblueApiKeyId: clean(env.SENDBLUE_API_KEY_ID),
    sendblueApiSecret: clean(env.SENDBLUE_API_SECRET),
    sendblueSigningSecret: clean(env.SENDBLUE_SIGNING_SECRET),
    sendbluePhoneNumber: clean(env.SENDBLUE_PHONE_NUMBER),
    slackBotToken: clean(env.SLACK_BOT_TOKEN),
    slackSigningSecret: clean(env.SLACK_SIGNING_SECRET),
    teamsAppId: clean(env.TEAMS_APP_ID),
    teamsAppPassword: clean(env.TEAMS_APP_PASSWORD),
    teamsAppTenantId: clean(env.TEAMS_APP_TENANT_ID),
    whatsappAccessToken: clean(env.WHATSAPP_ACCESS_TOKEN),
    whatsappPhoneNumberId: clean(env.WHATSAPP_PHONE_NUMBER_ID),
    whatsappAppSecret: clean(env.WHATSAPP_APP_SECRET),
    whatsappVerifyToken: clean(env.WHATSAPP_VERIFY_TOKEN),
    telegramBotToken: clean(env.TELEGRAM_BOT_TOKEN),
    telegramWebhookSecret: clean(env.TELEGRAM_WEBHOOK_SECRET_TOKEN),
    telegramBots: telegramBotsFromEnv(env),
    larkAppId: clean(env.LARK_APP_ID),
    larkAppSecret: clean(env.LARK_APP_SECRET),
    larkVerificationToken: clean(env.LARK_VERIFICATION_TOKEN),
    larkEncryptKey: clean(env.LARK_ENCRYPT_KEY),
    larkDomain: clean(env.LARK_DOMAIN),
    photonProjectId: clean(env.PHOTON_PROJECT_ID),
    photonProjectSecret: clean(env.PHOTON_PROJECT_SECRET),
    photonWebhookSecret: clean(env.PHOTON_WEBHOOK_SECRET),
    photonProjects: photonProjectsFromEnv(env),
    discordBot: discordBotFromEnv(env),
  };
}

export interface TelegramBotCredentials {
  name: string;
  botToken: string;
  webhookSecret: string;
}

const TELEGRAM_NAMED_TOKEN = /^TELEGRAM_BOT_TOKEN_([A-Z0-9]+)$/;

export function telegramBotsFromEnv(
  env: Record<string, string | undefined>,
): TelegramBotCredentials[] {
  const bots: TelegramBotCredentials[] = [];
  for (const [key, value] of Object.entries(env)) {
    const suffix = TELEGRAM_NAMED_TOKEN.exec(key)?.[1];
    if (!suffix) continue;
    const botToken = value?.trim();
    const webhookSecret = env[`TELEGRAM_WEBHOOK_SECRET_TOKEN_${suffix}`]?.trim();
    if (!botToken || !webhookSecret) continue;
    bots.push({ name: suffix.toLowerCase(), botToken, webhookSecret });
  }
  bots.sort((a, b) => a.name.localeCompare(b.name));
  return bots;
}

export interface PhotonProjectCredentials {
  name: string;
  projectId: string;
  projectSecret: string;
  webhookSecret?: string | undefined;
}

const PHOTON_NAMED_PROJECT = /^PHOTON_PROJECT_ID_([A-Z0-9]+)$/;

export function photonProjectsFromEnv(
  env: Record<string, string | undefined>,
): PhotonProjectCredentials[] {
  const projects: PhotonProjectCredentials[] = [];
  for (const [key, value] of Object.entries(env)) {
    const suffix = PHOTON_NAMED_PROJECT.exec(key)?.[1];
    if (!suffix) continue;
    const projectId = value?.trim();
    const projectSecret = env[`PHOTON_PROJECT_SECRET_${suffix}`]?.trim();
    if (!projectId || !projectSecret) continue;
    const webhookSecret = env[`PHOTON_WEBHOOK_SECRET_${suffix}`]?.trim() || undefined;
    projects.push({ name: suffix.toLowerCase(), projectId, projectSecret, webhookSecret });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export function messagingPlatformsFromEnv(
  env: MessagingEnvironmentValues,
  options: {
    pollInboundMessages?: boolean;
    sendblueTransport?: Pick<SendblueClientOptions, "baseURL" | "fetch">;
    larkTransport?: HttpInstance;
  } = {},
): MessagingPlatform[] {
  const platforms: MessagingPlatform[] = [];

  if (
    env.sendblueApiKeyId &&
    env.sendblueApiSecret &&
    env.sendblueSigningSecret &&
    env.sendbluePhoneNumber
  ) {
    const lineNumber = env.sendbluePhoneNumber;
    const config: Partial<SendblueAdapterConfig> = {
      apiKey: env.sendblueApiKeyId,
      apiSecret: env.sendblueApiSecret,
      defaultFromNumber: lineNumber,
      webhookSecret: env.sendblueSigningSecret,
      allowedServices: ["iMessage", "SMS", "RCS"],
      ...(env.apiUrl?.startsWith("https://")
        ? { statusCallbackUrl: new URL("/api/v1/messaging/webhook/sendblue", env.apiUrl).href }
        : {}),
    };
    const isDM = (threadId: string) => !decodeSendblueThreadId(threadId).groupId;
    const adapter = lazyChatAdapter(
      "sendblue",
      async () => {
        const { createSendblueAdapter } = await import("chat-adapter-sendblue");
        const sendblue = createSendblueAdapter(config);
        Object.assign(sendblue, {
          isDM,
          sdk: sendblue.getSdk().withOptions({
            maxRetries: 0,
            timeout: MESSAGING_SEND_TIMEOUT_MS,
            ...options.sendblueTransport,
          }),
        });
        return sendblue;
      },
      { encodeThreadId: encodeSendblueThreadId, decodeThreadId: decodeSendblueThreadId, isDM },
    );
    platforms.push({
      provider: "sendblue",
      capabilities: { direct: true, groups: true, receipt: "typing" },
      adapter,
      address: lineNumber,
      directThreadId: (address) =>
        encodeSendblueThreadId({ fromNumber: lineNumber, contactNumber: address }),
      peekStatuses: parseSendblueStatuses,
      participants: (raw) => sendblueParticipants(raw, lineNumber),
      rosterAt: (raw) => sendblueRosterAt(raw),
      channelName: (raw) => sendblueGroupName(raw),
      transport: (raw) => sendblueTransport(raw),
    });
  }

  if (env.slackBotToken && env.slackSigningSecret) {
    const config = {
      botToken: env.slackBotToken,
      signingSecret: env.slackSigningSecret,
      webClientOptions: {
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
        timeout: MESSAGING_SEND_TIMEOUT_MS,
      },
    };
    const adapter = lazyChatAdapter("slack", async () => {
      const { createSlackAdapter } = await import("@chat-adapter/slack");
      const slack = createSlackAdapter(config);
      boundInboundMarkdown(slack);
      const addReaction = slack.addReaction.bind(slack);
      Object.assign(slack, {
        addReaction: (threadId, messageId, emoji) =>
          addReaction(threadId, messageId, emoji).catch((error: unknown) => {
            if (slackPlatformError(error) !== "already_reacted") throw error;
          }),
      } satisfies Pick<Adapter, "addReaction">);
      return slack;
    });
    platforms.push({
      provider: "slack",
      capabilities: { direct: true, groups: true, receipt: "reaction" },
      adapter,
      enrichTeamRoom: enrichSlackTeamRoom,
      redeliveryKeys: slackRedeliveryKeys,
      isPermanentSendError: (error) => SLACK_PERMANENT_ERRORS.has(slackPlatformError(error) ?? ""),
    });
  }

  if (env.teamsAppId && env.teamsAppPassword && env.teamsAppTenantId) {
    const config = {
      appId: env.teamsAppId,
      appPassword: env.teamsAppPassword,
      appTenantId: env.teamsAppTenantId,
      appType: "SingleTenant" as const,
    };
    platforms.push({
      provider: "teams",
      capabilities: { direct: true, groups: false, receipt: "typing" },
      adapter: lazyChatAdapter("teams", async () => {
        const { createTeamsAdapter } = await import("@chat-adapter/teams");
        const adapter = createTeamsAdapter(config);
        boundInboundMarkdown(adapter);
        return adapter;
      }),
    });
  }

  if (
    env.whatsappAccessToken &&
    env.whatsappPhoneNumberId &&
    env.whatsappAppSecret &&
    env.whatsappVerifyToken
  ) {
    platforms.push({
      provider: "whatsapp",
      capabilities: { direct: true, groups: false, receipt: null },
      adapter: createWhatsAppAdapter({
        accessToken: env.whatsappAccessToken,
        phoneNumberId: env.whatsappPhoneNumberId,
        appSecret: env.whatsappAppSecret,
        verifyToken: env.whatsappVerifyToken,
      }),
      peekStatuses: parseWhatsAppStatuses,
      isPermanentSendError: (error) =>
        error instanceof WhatsAppApiError && error.errorCode === WHATSAPP_REENGAGEMENT_REQUIRED,
    });
  }

  const telegramTokens = new Set<string>();
  if (env.telegramBotToken && env.telegramWebhookSecret) {
    telegramTokens.add(env.telegramBotToken.trim());
    const adapter = telegramAdapter(env.telegramBotToken, env.telegramWebhookSecret, options);
    platforms.push({
      provider: "telegram",
      capabilities: { direct: true, groups: true, receipt: null, files: true },
      ...withTelegramRedelivery(adapter),
      ...telegramGroupHooks(adapter),
      isPermanentSendError: isTelegramBlocked,
    });
  }

  for (const bot of env.telegramBots ?? []) {
    if (telegramTokens.has(bot.botToken.trim())) {
      getLogger().warn("skipping Telegram bot that reuses another bot's token", {
        provider: `telegram-${bot.name}`,
      });
      continue;
    }
    telegramTokens.add(bot.botToken.trim());
    const adapter = telegramAdapter(bot.botToken, bot.webhookSecret, options);
    platforms.push({
      provider: `telegram-${bot.name}`,
      adapterName: "telegram",
      capabilities: { direct: true, groups: true, receipt: null, files: true },
      ...withTelegramRedelivery(adapter),
      ...telegramGroupHooks(adapter),
      isPermanentSendError: isTelegramBlocked,
    });
  }

  if (env.larkAppId && env.larkAppSecret && env.larkVerificationToken) {
    const adapter = new LazyLarkAdapter({
      ...(options.larkTransport ? { httpInstance: options.larkTransport } : {}),
      appId: env.larkAppId,
      appSecret: env.larkAppSecret,
      verificationToken: env.larkVerificationToken,
      encryptKey: env.larkEncryptKey ?? "",
      domain: env.larkDomain?.toLowerCase() === "lark" ? Domain.Lark : Domain.Feishu,
    });
    platforms.push({
      provider: "lark",
      capabilities: { direct: true, groups: false, receipt: null },
      adapter,
      postOnce: (threadId, message, idempotencyKey) =>
        adapter.postMessage(threadId, message, idempotencyKey),
    });
  }

  const photonProjects: (PhotonProjectCredentials & { provider: string })[] = [];
  if (env.photonProjectId && env.photonProjectSecret) {
    photonProjects.push({
      provider: "photon",
      name: "",
      projectId: env.photonProjectId,
      projectSecret: env.photonProjectSecret,
      webhookSecret: env.photonWebhookSecret,
    });
  }
  for (const project of env.photonProjects ?? []) {
    photonProjects.push({ ...project, provider: `photon-${project.name}` });
  }
  const photonIds = new Set<string>();
  for (const project of photonProjects) {
    if (photonIds.has(project.projectId)) {
      getLogger().warn("skipping Photon project that reuses another provider's project", {
        provider: project.provider,
      });
      continue;
    }
    photonIds.add(project.projectId);
    platforms.push({
      provider: project.provider,
      adapterName: "imessage",
      capabilities: { direct: true, groups: false, receipt: "typing" },
      adapter: new LazyPhotonAdapter({
        projectId: project.projectId,
        projectSecret: project.projectSecret,
        webhookSecret: project.webhookSecret,
        pollInboundMessages: options.pollInboundMessages ?? false,
      }),
    });
  }

  if (env.discordBot) {
    const credentials = env.discordBot;
    const receiveMessages = options.pollInboundMessages ?? false;
    platforms.push({
      provider: "discord",
      capabilities: { direct: true, groups: false, receipt: "typing", files: true },
      adapter: lazyChatAdapter("discord", () =>
        createDiscordAdapter({ ...credentials, receiveMessages }),
      ),
      isPermanentSendError: isDiscordUndeliverable,
    });
  }

  return platforms;
}

export function isMessagingEnabled(platforms: MessagingPlatform[]): boolean {
  return platforms.length > 0 && !isVitestRuntime();
}

export function isMessagingSurfaceEnabled(
  platforms: MessagingPlatform[],
  options: { deploymentModelConfigured: boolean; openSignup: boolean },
): boolean {
  if (!isMessagingEnabled(platforms)) return false;
  return options.openSignup ? options.deploymentModelConfigured : true;
}

const MESSAGING_SEND_TIMEOUT_MS = 10_000;

function encodeSendblueThreadId({ fromNumber, contactNumber, groupId }: SendblueThreadId): string {
  const from = Buffer.from(fromNumber).toString("base64url");
  if (groupId) return `sendblue:${from}:g:${Buffer.from(groupId).toString("base64url")}`;
  return `sendblue:${from}:${Buffer.from(contactNumber ?? "").toString("base64url")}`;
}

function decodeSendblueThreadId(threadId: string): SendblueThreadId {
  const [prefix, from, rest, group] = threadId.split(":");
  if (prefix !== "sendblue" || from === undefined || rest === undefined) {
    throw new Error(`Invalid Sendblue thread ID: ${threadId}`);
  }
  const fromNumber = Buffer.from(from, "base64url").toString();
  return rest === "g" && group
    ? { fromNumber, groupId: Buffer.from(group, "base64url").toString() }
    : { fromNumber, contactNumber: Buffer.from(rest, "base64url").toString() };
}

const SLACK_PERMANENT_ERRORS = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
]);

const WHATSAPP_REENGAGEMENT_REQUIRED = 131047;

const MESSAGE_PART_LIMIT = 4096;

function withTelegramRedelivery(adapter: TelegramAdapter) {
  return {
    adapter,
    redeliveryKeys: (payload: unknown) => {
      const scope = createHash("sha256").update(adapter.botUserId!).digest("hex");
      return [`${adapter.name}:webhook-update:${scope}:${asRecord(payload)?.update_id}`];
    },
  };
}

export function splitOutboundBody(provider: string, body: string): string[] {
  if (!body.trim()) return [];
  if (provider === "discord") {
    return splitMarkdown(body, { limit: DISCORD_MESSAGE_LIMIT, sent: (markdown) => [markdown] });
  }
  const sent =
    provider === "whatsapp"
      ? whatsappPayloads
      : provider === "telegram" || provider.startsWith("telegram-")
        ? telegramPayloads
        : undefined;
  return sent ? splitMarkdown(body, { limit: MESSAGE_PART_LIMIT, sent }) : [body];
}

const telegramFormat = new TelegramFormatConverter();

export function telegramFallbackText(
  markdown: string,
  ast: Root = parseMarkdown(markdown),
): string {
  const plainText = toPlainText(
    walkAst(ast, (node) => {
      const link = isLinkNode(node);
      if (!link && node.type !== "image") return node;
      const label = link
        ? toPlainText({ type: "root", children: [{ type: "paragraph", children: node.children }] })
        : (node.alt ?? "");
      if (!label) return text(node.url);
      const bare = node.url.replace(/^(?:https?:\/\/|mailto:)/, "");
      if (label === node.url || label === bare || label === bare.replace(/\/$/, "")) {
        return text(label);
      }
      return text(`${label} (${node.url})`);
    }),
  );
  return plainText.trim() ? plainText : markdown;
}

class TelegramAdapterWithLinkAddresses extends TelegramAdapter {
  protected override renderPlainTextMessage(
    message: AdapterPostableMessage,
    card: CardElement | null,
  ): string {
    return !card && typeof message === "object" && "markdown" in message
      ? telegramFallbackText(message.markdown)
      : super.renderPlainTextMessage(message, card);
  }
}

function telegramPayloads(markdown: string): string[] {
  const ast = parseMarkdown(markdown);
  return [telegramFormat.fromAst(ast), telegramFallbackText(markdown, ast)].map((text) =>
    convertEmojiPlaceholders(text, "gchat"),
  );
}

class WhatsAppRenderer extends WhatsAppAdapter {
  render(markdown: string): string {
    return convertEmojiPlaceholders(this.formatConverter.renderPostable({ markdown }), "whatsapp");
  }
}

let whatsappRenderer: WhatsAppRenderer | undefined;

function whatsappPayloads(markdown: string): string[] {
  whatsappRenderer ??= new WhatsAppRenderer({
    accessToken: "",
    appSecret: "",
    logger: new ConsoleLogger("silent"),
    phoneNumberId: "",
    userName: "",
    verifyToken: "",
  });
  return [whatsappRenderer.render(markdown)];
}

export function parseSendblueStatuses(payload: unknown): MessagingOutboundStatus[] {
  const body = asRecord(payload);
  const handle = body && stringField(body, "message_handle");
  if (body?.is_outbound !== true || !handle) return [];
  return [
    { type: "status", provider: "sendblue", handle, status: stringField(body, "status") ?? "" },
  ];
}

export function parseWhatsAppStatuses(payload: unknown): MessagingOutboundStatus[] {
  const statuses: MessagingOutboundStatus[] = [];
  for (const entry of arrayField(asRecord(payload), "entry")) {
    for (const change of arrayField(asRecord(entry), "changes")) {
      for (const item of arrayField(asRecord(asRecord(change)?.value), "statuses")) {
        const record = asRecord(item) ?? {};
        const handle = stringField(record, "id");
        const status = stringField(record, "status");
        if (!handle || !status) continue;
        statuses.push({
          type: "status",
          provider: "whatsapp",
          handle,
          status: status.toUpperCase(),
        });
      }
    }
  }
  return statuses;
}

function slackRedeliveryKeys(payload: unknown): string[] {
  const eventId = stringField(asRecord(payload) ?? {}, "event_id");
  return eventId ? [`slack:event-delivered:${eventId}`] : [];
}

function isTelegramBlocked(error: unknown): boolean {
  return error instanceof Error && error.name === "PermissionError";
}

function telegramAdapter(
  botToken: string,
  secretToken: string,
  options: { pollInboundMessages?: boolean },
) {
  return new TelegramAdapterWithLinkAddresses({
    botToken,
    secretToken,
    mode: options.pollInboundMessages ? "auto" : "webhook",
  });
}

function telegramGroupHooks(adapter: { readonly botUserId?: string }) {
  return {
    channelName: (raw: unknown) =>
      stringField(asRecord(asRecord(raw)?.chat) ?? {}, "title") ?? null,
    acceptsGroup: (raw: unknown) => asRecord(asRecord(raw)?.chat)?.type !== "channel",
    normalizeThreadId: telegramGroupThreadId,
    departures: (raw: unknown) => telegramDepartures(raw, adapter),
  };
}

function telegramDepartures(
  raw: unknown,
  adapter: { readonly botUserId?: string },
): { addresses: string[]; botLeft: boolean } | undefined {
  const id = asRecord(asRecord(raw)?.left_chat_member)?.id;
  if (typeof id !== "number" && typeof id !== "string") return undefined;
  return adapter.botUserId === String(id)
    ? { addresses: [], botLeft: true }
    : { addresses: [String(id)], botLeft: false };
}

function telegramGroupThreadId(threadId: string, raw: unknown): string {
  if (asRecord(raw)?.is_topic_message === true) return threadId;
  const parts = threadId.split(":");
  return parts.length === 3 && parts[0] === "telegram" ? `${parts[0]}:${parts[1]}` : threadId;
}

export function enrichSlackTeamRoom(
  raw: unknown,
  base: MessagingInboundMessage,
): Partial<MessagingInboundMessage> {
  const root = asRecord(raw);
  if (!root) return {};
  const event = asRecord(root.event) ?? root;
  const teamId =
    stringField(root, "team_id") ?? stringField(event, "team") ?? stringField(event, "team_id");
  const eventType = stringField(event, "type");
  const botProfile = asRecord(event.bot_profile) ?? {};
  const botId = stringField(event, "bot_id") ?? stringField(botProfile, "id");
  const threadTs = stringField(event, "thread_ts");
  const channel = stringField(event, "channel");
  const enrichment: Partial<MessagingInboundMessage> = {};
  if (teamId) enrichment.workspaceId = teamId;
  if (channel) enrichment.conversationKey = channel;
  if (botId) enrichment.senderIsBot = true;
  else if (typeof event.bot_id === "string" || event.subtype === "bot_message") {
    enrichment.senderIsBot = true;
  }
  if (threadTs) enrichment.replyThreadId = threadTs;
  else enrichment.replyThreadId = null;
  if (!base.isDirect) {
    enrichment.kind = eventType === "app_mention" || base.mentionsBot ? "mention" : "ambient";
  }
  return enrichment;
}

function slackPlatformError(error: unknown): string | undefined {
  const record = asRecord(error);
  if (record?.code !== "slack_webapi_platform_error") return undefined;
  return stringField(asRecord(record.data) ?? {}, "error");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function arrayField(record: Record<string, unknown> | null, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function sendblueParticipants(raw: unknown, lineNumber: string): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const participants = (raw as { participants?: unknown }).participants;
  if (!Array.isArray(participants)) return [];
  return participants.filter(
    (entry): entry is string => typeof entry === "string" && entry !== lineNumber,
  );
}

function sendblueRosterAt(raw: unknown): Date | null {
  if (typeof raw !== "object" || raw === null) return null;
  const sent = (raw as { date_sent?: unknown }).date_sent;
  if (typeof sent !== "string") return null;
  const at = new Date(sent);
  return Number.isNaN(at.getTime()) ? null : at;
}

function sendblueGroupName(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const name = (raw as { group_display_name?: unknown }).group_display_name;
  return typeof name === "string" && name ? name : null;
}

function sendblueTransport(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const service = (raw as { service?: unknown }).service;
  return service === "iMessage" || service === "SMS" || service === "RCS" ? service : null;
}
