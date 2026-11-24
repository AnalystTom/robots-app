import { abortableDelay } from "@robots/core";
import { getLogger } from "@robots/logging";
import type { Adapter, AdapterPostableMessage, ChatInstance, Logger } from "chat";
import { StreamInboundRetries } from "../stream-inbound-retries.js";

export interface DiscordBotCredentials {
  botToken: string;
  applicationId: string;
}

export interface DiscordAdapterOptions extends DiscordBotCredentials {
  receiveMessages: boolean;
}

export const DISCORD_MESSAGE_LIMIT = 2000;

export const DISCORD_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const DISCORD_GATEWAY_SESSION_MS = 2 ** 31 - 1;

export const DISCORD_GATEWAY_STABLE_MS = 60_000;

export const DISCORD_GATEWAY_RECONNECT_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

const DISCORD_BOT_TOKEN = /^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const UNDELIVERABLE_STATUSES = new Set([401, 403, 404]);

export function discordBotFromEnv(
  env: Record<string, string | undefined>,
): DiscordBotCredentials | undefined {
  const botToken = env.DISCORD_BOT_TOKEN?.trim() || undefined;
  const applicationId = env.DISCORD_APPLICATION_ID?.trim() || undefined;
  if (!botToken && !applicationId) return undefined;
  if (!botToken || !applicationId) {
    throw new Error(
      "Discord needs both DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID. Set both, or neither to turn Discord off.",
    );
  }
  if (!DISCORD_SNOWFLAKE.test(applicationId)) {
    throw new Error(
      "DISCORD_APPLICATION_ID must be the numeric Application ID from General Information in the Discord developer portal.",
    );
  }
  if (!isDiscordBotToken(botToken)) {
    throw new Error(
      "DISCORD_BOT_TOKEN is not a Discord bot token. Copy it from Bot → Reset Token in the Discord developer portal, without a 'Bot ' prefix.",
    );
  }
  return { botToken, applicationId };
}

function isDiscordBotToken(token: string): boolean {
  const userId = DISCORD_BOT_TOKEN.exec(token)?.[1];
  return userId !== undefined && DISCORD_SNOWFLAKE.test(Buffer.from(userId, "base64").toString());
}

export function isDiscordUndeliverable(error: unknown): boolean {
  const cause = (error as { originalError?: { name?: unknown; status?: unknown } } | null)
    ?.originalError;
  return (
    cause?.name === "DiscordApiError" &&
    typeof cause.status === "number" &&
    UNDELIVERABLE_STATUSES.has(cause.status)
  );
}

export function discordGatewayAdvice(error: unknown): string | undefined {
  const text = String(error);
  if (/disallowed intents/i.test(text)) {
    return "Discord refused the gateway connection. Turn on Message Content Intent under Bot → Privileged Gateway Intents in the Discord developer portal.";
  }
  if (/invalid token|TokenInvalid|401/i.test(text)) {
    return "Discord rejected DISCORD_BOT_TOKEN. Reset the token under Bot in the Discord developer portal and update the setting.";
  }
  return undefined;
}

export async function keepGatewayOpen(
  connect: (signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    const startedAt = Date.now();
    await connect(signal);
    if (signal.aborted) return;
    failures = Date.now() - startedAt >= DISCORD_GATEWAY_STABLE_MS ? 0 : failures + 1;
    if (failures === 0) continue;
    const delayMs =
      DISCORD_GATEWAY_RECONNECT_DELAYS_MS[
        Math.min(failures, DISCORD_GATEWAY_RECONNECT_DELAYS_MS.length) - 1
      ]!;
    getLogger().warn("discord gateway disconnected; reconnecting", { delayMs });
    await abortableDelay(delayMs, signal);
  }
}

const discordLogger: Logger = {
  child: () => discordLogger,
  debug: () => undefined,
  info: () => undefined,
  warn: (message, bindings) => getLogger().warn(`discord: ${message}`, logBindings(bindings)),
  error: (message, bindings) => {
    const fields = logBindings(bindings);
    getLogger().error(`discord: ${discordGatewayAdvice(fields?.error) ?? message}`, fields);
  },
};

function logBindings(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export async function createDiscordAdapter(options: DiscordAdapterOptions): Promise<Adapter> {
  const { DiscordAdapter } = await import("@chat-adapter/discord");

  class DirectMessageDiscordAdapter extends DiscordAdapter {
    private readonly retries = new StreamInboundRetries("discord");
    private session: AbortController | undefined;

    override async initialize(chat: ChatInstance): Promise<void> {
      if (!options.receiveMessages) return super.initialize(chat);
      await super.initialize(this.retries.wrap(chat));
      this.openGateway();
    }

    async stopPolling(): Promise<void> {
      this.session?.abort();
      this.session = undefined;
      this.retries.stop();
    }

    async disconnect(): Promise<void> {
      await this.stopPolling();
    }

    protected override async handleGatewayMessage(
      message: { guildId: string | null },
      isMentioned: boolean,
    ): Promise<void> {
      if (message.guildId) return;
      await super.handleGatewayMessage(message as never, isMentioned);
    }

    protected override buildMessagePayload(
      message: AdapterPostableMessage,
      payloadOptions?: { clearContentForCard?: boolean },
    ) {
      if (typeof message === "object" && "markdown" in message && !("card" in message)) {
        return {
          componentCount: 0,
          embedCount: 0,
          payload: { content: this.truncateContent(message.markdown) },
        };
      }
      return super.buildMessagePayload(message, payloadOptions);
    }

    private openGateway(): void {
      if (this.session) return;
      const session = new AbortController();
      this.session = session;
      void keepGatewayOpen(
        (signal) => this.runGatewayListener(DISCORD_GATEWAY_SESSION_MS, signal),
        session.signal,
      );
    }
  }

  return new DirectMessageDiscordAdapter({
    botToken: options.botToken,
    applicationId: options.applicationId,
    webhookVerifier: () => false,
    logger: discordLogger,
    userName: "robots",
  });
}
