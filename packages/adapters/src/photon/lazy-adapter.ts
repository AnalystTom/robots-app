import type { iMessageAdapter } from "@photon-ai/chat-adapter-imessage";
import { getLogger } from "@robots/logging";
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FormattedContent,
  Logger,
  WebhookOptions,
} from "chat";
import { stringifyMarkdown } from "chat";
import { StreamInboundRetries } from "../stream-inbound-retries.js";

export interface PhotonAdapterConfig {
  projectId: string;
  projectSecret: string;
  webhookSecret?: string | undefined;
  pollInboundMessages: boolean;
}

export interface PhotonThreadId {
  chatGuid: string;
  phone?: string;
}

const THREAD_PREFIX = "imessage:";
const LINE_SEP = "~";

export const PHOTON_LISTEN_WINDOW_MS = 60_000;

const photonLogger: Logger = {
  child: () => photonLogger,
  debug: () => undefined,
  info: () => undefined,
  warn: (message, bindings) => getLogger().warn(`photon: ${message}`, logBindings(bindings)),
  error: (message, bindings) => getLogger().error(`photon: ${message}`, logBindings(bindings)),
};

function logBindings(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function encodePhotonThreadId({ chatGuid, phone }: PhotonThreadId): string {
  return phone ? `${THREAD_PREFIX}${chatGuid}${LINE_SEP}${phone}` : `${THREAD_PREFIX}${chatGuid}`;
}

export function decodePhotonThreadId(threadId: string): PhotonThreadId {
  if (!threadId.startsWith(THREAD_PREFIX)) {
    throw new Error(`Invalid iMessage thread ID: ${threadId}`);
  }
  const rest = threadId.slice(THREAD_PREFIX.length);
  const sep = rest.indexOf(LINE_SEP);
  const chatGuid = sep === -1 ? rest : rest.slice(0, sep);
  if (!chatGuid) throw new Error(`Invalid iMessage thread ID: ${threadId}`);
  return sep === -1 ? { chatGuid } : { chatGuid, phone: rest.slice(sep + 1) };
}

export class LazyPhotonAdapter implements Adapter {
  readonly name = "imessage";
  private loaded: Promise<iMessageAdapter> | undefined;
  private implementation: iMessageAdapter | undefined;
  private listening: ReturnType<typeof setInterval> | undefined;
  private window: AbortController | undefined;
  private readonly retries = new StreamInboundRetries("photon");
  constructor(readonly config: PhotonAdapterConfig) {}

  get userName() {
    return this.implementation?.userName ?? "imessage";
  }
  private load() {
    this.loaded ??= (async () => {
      const { iMessageAdapter } = await import("@photon-ai/chat-adapter-imessage");
      this.implementation = new iMessageAdapter({
        logger: photonLogger,
        projectId: this.config.projectId,
        projectSecret: this.config.projectSecret,
        ...(this.config.webhookSecret ? { webhookSecret: this.config.webhookSecret } : {}),
      });
      return this.implementation;
    })().catch((error: unknown) => {
      this.loaded = undefined;
      throw error;
    });
    return this.loaded;
  }
  async initialize(chat: ChatInstance) {
    const adapter = await this.load();
    const streaming = this.config.pollInboundMessages && !this.config.webhookSecret;
    await adapter.initialize(streaming ? this.retries.wrap(chat) : chat);
    if (streaming) this.startListening(adapter);
  }

  async stopPolling() {
    clearInterval(this.listening);
    this.listening = undefined;
    this.window?.abort();
    this.window = undefined;
    this.retries.stop();
  }

  private startListening(adapter: iMessageAdapter) {
    if (this.listening) return;
    const options: WebhookOptions = {
      waitUntil: (task) => {
        task.catch(() => undefined);
      },
    };
    const listen = () => {
      this.window = new AbortController();
      adapter
        .startGatewayListener(options, PHOTON_LISTEN_WINDOW_MS, this.window.signal)
        .then((response) => {
          if (!response.ok) {
            getLogger().warn("photon inbound listener did not start", { status: response.status });
          }
        })
        .catch((error: unknown) => {
          getLogger().warn("photon inbound listener failed", { error: String(error) });
        });
    };
    listen();
    this.listening = setInterval(listen, PHOTON_LISTEN_WINDOW_MS);
    this.listening.unref?.();
  }

  async handleWebhook(request: Request, options?: WebhookOptions) {
    return (await this.load()).handleWebhook(request, options);
  }
  async postMessage(threadId: string, message: AdapterPostableMessage) {
    return (await this.load()).postMessage(threadId, message);
  }
  async editMessage(threadId: string, messageId: string, message: AdapterPostableMessage) {
    return (await this.load()).editMessage(threadId, messageId, message);
  }
  async deleteMessage(threadId: string, messageId: string) {
    await (await this.load()).deleteMessage(threadId, messageId);
  }
  async addReaction(threadId: string, messageId: string, emoji: EmojiValue | string) {
    await (await this.load()).addReaction(threadId, messageId, emoji);
  }
  async removeReaction(threadId: string, messageId: string, emoji: EmojiValue | string) {
    await (await this.load()).removeReaction(threadId, messageId, emoji);
  }
  async startTyping(threadId: string) {
    await (await this.load()).startTyping(threadId);
  }
  async fetchMessage(threadId: string, messageId: string) {
    return (await this.load()).fetchMessage(threadId, messageId);
  }
  async fetchMessages(threadId: string) {
    return (await this.load()).fetchMessages(threadId);
  }
  async fetchThread(threadId: string) {
    return (await this.load()).fetchThread(threadId);
  }
  async openDM(userId: string) {
    return (await this.load()).openDM(userId);
  }
  async disconnect() {
    await this.stopPolling();
  }
  parseMessage(raw: unknown) {
    if (!this.implementation) throw new Error("Photon adapter is not initialized");
    return this.implementation.parseMessage(raw);
  }
  renderFormatted(content: FormattedContent) {
    return this.implementation?.renderFormatted(content) ?? stringifyMarkdown(content);
  }
  encodeThreadId(platformData: PhotonThreadId) {
    return encodePhotonThreadId(platformData);
  }
  decodeThreadId(threadId: string) {
    return decodePhotonThreadId(threadId);
  }
  channelIdFromThreadId(threadId: string) {
    return threadId;
  }
  isDM(threadId: string) {
    return decodePhotonThreadId(threadId).chatGuid.includes(";-;");
  }
}
