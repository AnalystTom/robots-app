import { AsyncLocalStorage } from "node:async_hooks";
import { createMemoryState } from "@chat-adapter/state-memory";
import type {
  AdapterContext,
  AdapterDescriptor,
  MessagingCapabilities,
  MessagingInboundAttachment,
  MessagingInboundEvent,
  MessagingInboundMessage,
  MessagingOutboundAttachment,
  MessagingOutboundStatus,
  MessagingPlatformDescriptor,
  MessagingReceipt,
  MessagingSendRequest,
  MessagingSendResult,
  MessagingSurface,
} from "@robots/adapter-kit";
import { getLogger } from "@robots/logging";
import type { Adapter, Message, PostableMarkdown, Root, Thread } from "chat";
import { Chat, isLinkNode, paragraph, parseMarkdown, root, text, toPlainText, walkAst } from "chat";
import { DISCORD_UPLOAD_MAX_BYTES } from "./discord/adapter.js";
import { getLarkTextParts } from "./lark/text-parts.js";

const webhookDrain = new AsyncLocalStorage<{
  pending: Promise<unknown>[];
  failedKeys: string[];
  markdownChars: number;
}>();

export const INBOUND_MARKDOWN_MAX_CHARS = 8_000;

export function boundInboundMarkdown(adapter: Adapter): void {
  const converter = (adapter as unknown as { formatConverter: { toAst(value: string): Root } })
    .formatConverter;
  const toAst = converter.toAst.bind(converter);
  converter.toAst = (value) => {
    const drain = webhookDrain.getStore();
    if (!drain) return toAst(value);
    drain.markdownChars += value.length;
    if (drain.markdownChars <= INBOUND_MARKDOWN_MAX_CHARS) {
      try {
        return toAst(value);
      } catch {}
    }
    return root([paragraph([text(value)])]);
  };
}

export const MESSAGING_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const TELEGRAM_PHOTO_MAX_BYTES = 10_000_000;
const TELEGRAM_UPLOAD_MAX_BYTES = 50_000_000;
const TELEGRAM_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const UPLOAD_LIMITS: Record<string, { maxBytes: number; app: string }> = {
  telegram: { maxBytes: TELEGRAM_UPLOAD_MAX_BYTES, app: "Telegram" },
  discord: { maxBytes: DISCORD_UPLOAD_MAX_BYTES, app: "Discord" },
};

export interface MessagingPlatform {
  provider: string;
  capabilities: MessagingCapabilities;
  adapter: Adapter;
  adapterName?: string;
  address?: string;
  directThreadId?: (address: string) => string;
  peekStatuses?: (payload: unknown) => MessagingOutboundStatus[];
  redeliveryKeys?: (payload: unknown) => string[];
  isPermanentSendError?: (error: unknown) => boolean;
  postOnce?: (
    threadId: string,
    message: string | PostableMarkdown,
    idempotencyKey: string,
  ) => Promise<{ id: string }>;
  participants?: (raw: unknown) => string[];
  rosterAt?: (raw: unknown) => Date | null;
  departures?: (raw: unknown) => { addresses: string[]; botLeft: boolean } | undefined;
  channelName?: (raw: unknown) => string | null;
  acceptsGroup?: (raw: unknown) => boolean;
  normalizeThreadId?: (threadId: string, raw: unknown) => string;
  transport?: (raw: unknown) => string | null;
  enrichTeamRoom?: (
    raw: unknown,
    base: MessagingInboundMessage,
  ) => Partial<MessagingInboundMessage>;
}

interface MountedPlatform {
  platform: MessagingPlatform;
  adapterName: string;
  chat: Chat<Record<string, Adapter>>;
}

export class ChatSdkMessagingSurface implements MessagingSurface {
  private readonly byProvider = new Map<string, MountedPlatform>();
  private sink: ((event: MessagingInboundEvent) => Promise<void>) | undefined;
  private initialized: Promise<void> | undefined;

  constructor(platforms: MessagingPlatform[], options: { userName?: string } = {}) {
    if (platforms.length === 0) throw new Error("ChatSdkMessagingSurface needs >=1 platform");
    for (const platform of platforms) {
      if (this.byProvider.has(platform.provider)) {
        throw new Error(`Duplicate messaging provider: ${platform.provider}`);
      }
      const adapterName = platform.adapterName ?? platform.provider;
      const chat = new Chat({
        userName: options.userName ?? "robots",
        adapters: { [adapterName]: platform.adapter },
        state: createMemoryState(),
        concurrency: "concurrent",
      });
      const mounted: MountedPlatform = { platform, adapterName, chat };
      this.byProvider.set(platform.provider, mounted);
      const deliver = async (thread: Thread, message: Message) => {
        if (
          platform.provider === "slack" &&
          message.isMention &&
          message.attachments.length > 0 &&
          inboundAttachments(message).length === 0 &&
          (message.raw as { type?: unknown }).type === "app_mention"
        ) {
          try {
            const fetchMessage = platform.adapter.fetchMessage;
            if (!fetchMessage) throw new Error("Slack adapter cannot hydrate mention attachments");
            const fetched = await fetchMessage.call(platform.adapter, thread.id, message.id);
            if (!fetched || inboundAttachments(fetched).length === 0) {
              throw new Error("Slack mention attachments are not available from message history");
            }
            message.attachments = fetched.attachments;
          } catch {
            getLogger().warn(
              "Slack mention attachment hydration failed; delivering original message",
            );
          }
        }
        const event = this.toInbound(mounted, thread.id, thread.isDM, message);
        if (!event) return;
        try {
          await this.sink?.(event);
        } catch (error) {
          webhookDrain.getStore()?.failedKeys.push(chatDedupeKey(platform.adapter, message.id));
          throw error;
        }
      };
      chat.onDirectMessage(deliver);
      chat.onNewMention(deliver);
      chat.onSubscribedMessage(deliver);
      chat.onNewMessage(/(?:)/, deliver);
    }
  }

  describe(): AdapterDescriptor<{ providers: string[] }> {
    return {
      id: "chat-sdk",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { providers: [...this.byProvider.keys()] },
    };
  }

  platforms(): MessagingPlatformDescriptor[] {
    return [...this.byProvider.values()].map(({ platform }) => ({
      provider: platform.provider,
      capabilities: platform.capabilities,
      address: platform.address,
    }));
  }

  onInbound(sink: (event: MessagingInboundEvent) => Promise<void>): void {
    this.sink = sink;
  }

  handleWebhook(provider: string, request: Request): Promise<Response> | null {
    const mounted = this.byProvider.get(provider);
    if (!mounted) return null;
    return this.dispatchWebhook(mounted, request);
  }

  async sendToThread(
    request: MessagingSendRequest,
    context: AdapterContext,
  ): Promise<MessagingSendResult> {
    const mounted = this.mountedForThread(request.threadId);
    await this.ensureInitialized();
    context.signal.throwIfAborted();
    const telegram = mounted.adapterName === "telegram";
    const markdown =
      telegram ||
      mounted.adapterName === "whatsapp" ||
      mounted.adapterName === "lark" ||
      mounted.adapterName === "imessage" ||
      mounted.adapterName === "discord";
    const { attachment } = request;
    const uploadLimit = UPLOAD_LIMITS[mounted.adapterName];
    if (uploadLimit && attachment && attachment.data.byteLength > uploadLimit.maxBytes) {
      throw new MessagingSendError(new Error(`File is larger than ${uploadLimit.app} accepts`), {
        permanent: true,
        retryAfterMs: null,
      });
    }
    const message = attachment
      ? attachmentMessage(telegram, request.body, attachment)
      : markdown
        ? { markdown: request.body }
        : request.body;
    try {
      const threadId = toAdapterThreadId(mounted, request.threadId);
      const postOnce = mounted.platform.postOnce;
      const sent =
        postOnce && request.idempotencyKey && !attachment
          ? await postOnce(
              threadId,
              markdown ? { markdown: request.body } : request.body,
              request.idempotencyKey,
            )
          : await mounted.chat.thread(threadId).post(message);
      const handle = "id" in sent && typeof sent.id === "string" ? sent.id : "";
      return { handle };
    } catch (error) {
      throw sendError(mounted.platform, error);
    }
  }

  async openDirectThread(
    provider: string,
    address: string,
    _context: AdapterContext,
  ): Promise<string> {
    const mounted = this.byProvider.get(provider);
    if (!mounted) throw new Error(`Unknown messaging provider: ${provider}`);
    const { platform } = mounted;
    if (platform.directThreadId) return platform.directThreadId(address);
    await this.ensureInitialized();
    if (!platform.adapter.openDM) {
      throw new Error(`${provider} cannot open direct conversations`);
    }
    try {
      return toProviderThreadId(mounted, await platform.adapter.openDM(address));
    } catch (error) {
      throw sendError(platform, error);
    }
  }

  async acknowledge(threadId: string, handle: string, context: AdapterContext): Promise<void> {
    const mounted = this.byProvider.get(providerOfThreadId(threadId));
    const receipt = mounted?.platform.capabilities.receipt;
    if (!mounted || !receipt) return;
    await this.ensureInitialized();
    const { platform } = mounted;
    const adapterThreadId = toAdapterThreadId(mounted, threadId);
    const sends: Record<MessagingReceipt, () => Promise<void>> = {
      typing: () => platform.adapter.startTyping(adapterThreadId),
      reaction: () => platform.adapter.addReaction(adapterThreadId, handle, "eyes"),
    };
    await raceWithSignal(sends[receipt](), context.signal);
  }

  async fetchThreadHistory(
    threadId: string,
    options: { before: string; limit: number },
    context: AdapterContext,
  ): Promise<MessagingInboundMessage[]> {
    const mounted = this.byProvider.get(providerOfThreadId(threadId));
    if (!mounted) return [];
    await this.ensureInitialized();
    const adapterThreadId = toAdapterThreadId(mounted, threadId);
    const fetched = await raceWithSignal(
      mounted.platform.adapter.fetchMessages(adapterThreadId, {
        limit: options.limit + 1,
        direction: "backward",
      }),
      context.signal,
    );
    const end = fetched.messages.findIndex((message) => message.id === options.before);
    if (end < 0) return [];
    const isDirect = mounted.platform.adapter.isDM?.(adapterThreadId) ?? false;
    return fetched.messages
      .slice(0, end)
      .slice(-options.limit)
      .flatMap((message) => this.toInbound(mounted, adapterThreadId, isDirect, message) ?? []);
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async shutdown(): Promise<void> {
    const pending = this.initialized;
    this.initialized = undefined;
    if (pending) await pending.catch(() => undefined);
    await this.stopPollingAdapters();
    await this.shutdownChats();
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      const chats = [...this.byProvider.values()].map(({ chat }) => chat.initialize());
      this.initialized = Promise.all(chats).then(
        () => undefined,
        async (error: unknown) => {
          try {
            await Promise.allSettled(chats);
            await this.stopPollingAdapters();
            await this.shutdownChats();
          } finally {
            this.initialized = undefined;
          }
          throw error;
        },
      );
    }
    return this.initialized;
  }

  private async stopPollingAdapters(): Promise<void> {
    for (const { platform } of this.byProvider.values()) {
      const adapter = platform.adapter as { stopPolling?: () => Promise<void> };
      await adapter.stopPolling?.().catch(() => undefined);
    }
  }

  private async shutdownChats(): Promise<void> {
    for (const { chat } of this.byProvider.values()) {
      await (chat as { shutdown?: () => Promise<void> }).shutdown?.().catch(() => undefined);
    }
  }

  private mountedForThread(threadId: string): MountedPlatform {
    const mounted = this.byProvider.get(providerOfThreadId(threadId));
    if (!mounted) throw new Error(`No messaging provider mounted for thread ${threadId}`);
    return mounted;
  }

  private async dispatchWebhook(mounted: MountedPlatform, request: Request): Promise<Response> {
    const { platform, adapterName, chat } = mounted;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MESSAGING_WEBHOOK_MAX_BODY_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await readBoundedText(request, MESSAGING_WEBHOOK_MAX_BODY_BYTES) : "";
    if (body === null) {
      return new Response("Payload too large", { status: 413 });
    }
    const forwarded = hasBody
      ? new Request(request.url, { method: request.method, headers: request.headers, body })
      : request;
    const drain = {
      pending: [] as Promise<unknown>[],
      failedKeys: [] as string[],
      markdownChars: 0,
    };
    const response = await webhookDrain.run(drain, async () => {
      const adapterResponse = await chat.webhooks[adapterName]!(forwarded, {
        waitUntil: (task) => {
          drain.pending.push(task);
        },
      });
      await Promise.all(drain.pending);
      return adapterResponse;
    });
    const payload = parseJson(body);
    if (drain.failedKeys.length > 0) {
      const state = chat.getState();
      const keys = [...drain.failedKeys, ...(platform.redeliveryKeys?.(payload) ?? [])];
      await Promise.all(keys.map((key) => state.delete(key)));
      return new Response("Inbound processing failed", { status: 500 });
    }
    if (platform.peekStatuses && response.status < 300) {
      for (const status of platform.peekStatuses(payload)) await this.sink?.(status);
    }
    return response;
  }

  private toInbound(
    mounted: MountedPlatform,
    threadId: string,
    isDirect: boolean,
    message: Message,
  ): MessagingInboundMessage | null {
    if (message.author.isMe || message.author.isSystem) return null;
    const { platform } = mounted;
    if (!isDirect && !platform.capabilities.groups) return null;
    if (!isDirect && platform.acceptsGroup?.(message.raw) === false) return null;
    const fromLabel = message.author.fullName || message.author.userName || null;
    const transport = platform.transport?.(message.raw) ?? null;
    const attachments = inboundAttachments(message);
    const departures = isDirect ? undefined : platform.departures?.(message.raw);
    const rosterAt = isDirect ? undefined : (platform.rosterAt?.(message.raw) ?? undefined);
    const base: MessagingInboundMessage = {
      type: "message",
      provider: platform.provider,
      ...(transport ? { transport } : {}),
      handle: message.id,
      threadId: toProviderThreadId(
        mounted,
        platform.normalizeThreadId?.(threadId, message.raw) ?? threadId,
      ),
      isDirect,
      from: message.author.userId,
      fromLabel: fromLabel === message.author.userId ? null : fromLabel,
      channelName: isDirect ? null : (platform.channelName?.(message.raw) ?? null),
      participants: isDirect ? [] : (platform.participants?.(message.raw) ?? []),
      ...(rosterAt ? { rosterAt } : {}),
      content: [
        plainTextWithLinks(message, platform.provider === "lark"),
        ...(attachments.length
          ? message.attachments
              .filter((file) => !file.fetchData && file.url)
              .map((file) => file.url)
          : []),
      ]
        .filter(Boolean)
        .join("\n"),
      mediaUrl: message.attachments.find((attachment) => attachment.url)?.url ?? null,
      ...(attachments.length ? { attachments } : {}),
      ...(!isDirect && message.isMention ? { mentionsBot: true } : {}),
      ...(departures ? { departures } : {}),
    };
    const enrichment = platform.enrichTeamRoom?.(message.raw, base) ?? {};
    return { ...base, ...enrichment };
  }
}

function attachmentMessage(
  telegram: boolean,
  body: string,
  file: MessagingOutboundAttachment,
): PostableMarkdown {
  const data = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
  if (
    telegram &&
    TELEGRAM_PHOTO_TYPES.has(file.mimeType) &&
    data.byteLength <= TELEGRAM_PHOTO_MAX_BYTES
  ) {
    return {
      markdown: body,
      attachments: [{ type: "image", data, name: file.name, mimeType: file.mimeType }],
    };
  }
  return { markdown: body, files: [{ data, filename: file.name, mimeType: file.mimeType }] };
}

function inboundAttachments(message: Message): MessagingInboundAttachment[] {
  return message.attachments.flatMap((attachment) => {
    const fetchData = attachment.fetchData;
    if (!fetchData) return [];
    return [
      {
        name: attachment.name || attachment.type,
        mimeType: attachment.mimeType ?? "",
        ...(attachment.size !== undefined ? { size: attachment.size } : {}),
        fetch: async () => new Uint8Array(await fetchData()),
      },
    ];
  });
}

function plainTextWithLinks(message: Message, lark: boolean): string {
  const parts = lark ? getLarkTextParts(message.formatted) : undefined;
  if (parts) {
    const rendered = parts.map((part, index) => {
      if (part.literal) return { value: part.text, addedTarget: false };
      const value = part.text;
      if (!value.trim()) return { value, addedTarget: false };
      const result = renderLinks(parseMarkdown(value));
      const first = result.ast.children.at(0);
      const last = result.ast.children.at(-1);
      const start = first?.position?.start.offset ?? 0;
      const end = last?.position?.end.offset ?? value.length;
      const prefix = value.slice(0, start);
      const previous = parts[index - 1];
      const sameLine = previous?.literal && !previous.text.endsWith("\n") && !prefix.includes("\n");
      const leading = sameLine ? prefix : prefix.replace(/[^\r\n]/g, "");
      let trailing = value.slice(end);
      if (last?.type === "paragraph" && !trailing && parts[index + 1]?.literal)
        trailing = value.match(/[ \t]+$/)?.[0] ?? "";
      const headingBreak =
        parts[index + 1]?.literal &&
        result.ast.children.at(-1)?.type === "heading" &&
        trailing === "\n"
          ? "\n"
          : "";
      return {
        value: leading + toPlainText(result.ast) + headingBreak + trailing,
        addedTarget: result.addedTarget,
      };
    });
    return rendered.some((part) => part.addedTarget)
      ? rendered.map((part) => part.value).join("")
      : (message.text ?? "");
  }
  const result = renderLinks(message.formatted);
  return result.addedTarget ? toPlainText(result.ast) : (message.text ?? "");
}

function renderLinks(formatted: Message["formatted"]): {
  ast: Message["formatted"];
  addedTarget: boolean;
} {
  let addedTarget = false;
  const ast = walkAst(structuredClone(formatted), (node) => {
    if (!isLinkNode(node)) return node;
    const label = toPlainText({ type: "root", children: node.children }).trim();
    const bare = node.url.replace(/^(?:https?:\/\/|mailto:)/, "");
    if (!label) {
      addedTarget = true;
      return text(node.url);
    }
    if (label === node.url || label === bare || label === bare.replace(/\/$/, ""))
      return text(label);
    addedTarget = true;
    return text(`${label} (${node.url})`);
  });
  return { ast, addedTarget };
}

export function providerOfThreadId(threadId: string): string {
  return threadId.split(":", 1)[0]?.split("~", 1)[0] ?? "";
}

function toProviderThreadId(mounted: MountedPlatform, threadId: string): string {
  const { provider } = mounted.platform;
  if (mounted.adapterName === provider) return threadId;
  const prefix = `${mounted.adapterName}:`;
  return threadId.startsWith(prefix) ? `${provider}:${threadId.slice(prefix.length)}` : threadId;
}

function toAdapterThreadId(mounted: MountedPlatform, threadId: string): string {
  const { provider } = mounted.platform;
  if (mounted.adapterName === provider) return threadId;
  const prefix = `${provider}:`;
  return threadId.startsWith(prefix)
    ? `${mounted.adapterName}:${threadId.slice(prefix.length)}`
    : threadId;
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => undefined);
      reject(signal.reason ?? new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function chatDedupeKey(adapter: Adapter, messageId: string): string {
  const key = `dedupe:${adapter.name}:${messageId}`;
  const scope = adapter.getConcurrencyScope?.();
  return scope === undefined ? key : `concurrency:${JSON.stringify([adapter.name, scope, key])}`;
}

export class MessagingSendError extends Error {
  override readonly name = "MessagingSendError";
  readonly permanent: boolean;
  readonly retryAfterMs: number | null;

  constructor(cause: unknown, options: { permanent: boolean; retryAfterMs: number | null }) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.permanent = options.permanent;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function sendError(platform: MessagingPlatform, error: unknown): MessagingSendError {
  const seconds = (error as { retryAfter?: unknown } | null)?.retryAfter;
  return new MessagingSendError(error, {
    permanent: platform.isPermanentSendError?.(error) ?? false,
    retryAfterMs: typeof seconds === "number" && seconds > 0 ? seconds * 1000 : null,
  });
}
