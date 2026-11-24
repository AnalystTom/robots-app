import { getLogger } from "@robots/logging";
import type { Adapter, ChatInstance, Message } from "chat";

export const STREAM_INBOUND_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

type ProcessArgs = Parameters<ChatInstance["processMessage"]>;

export class StreamInboundRetries {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private open = false;

  constructor(private readonly source: string) {}

  wrap(chat: ChatInstance): ChatInstance {
    this.open = true;
    const processMessage = (...args: ProcessArgs) => this.watch(chat, args, 0);
    const handleIncomingMessage = (adapter: Adapter, threadId: string, message: Message) => {
      const task = chat.handleIncomingMessage(adapter, threadId, message);
      this.retryOnFailure(chat, task, [adapter, threadId, message, {}], 0);
      return task;
    };
    return new Proxy(chat, {
      get: (target, key) => {
        if (key === "processMessage") return processMessage;
        if (key === "handleIncomingMessage") return handleIncomingMessage;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  stop(): void {
    this.open = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private watch(chat: ChatInstance, args: ProcessArgs, attempt: number): Promise<void> {
    const task = chat.processMessage(...args);
    this.retryOnFailure(chat, task, args, attempt);
    return task;
  }

  private retryOnFailure(
    chat: ChatInstance,
    task: Promise<unknown>,
    [adapter, threadId, message, options]: ProcessArgs,
    attempt: number,
  ): void {
    task.catch((error: unknown) => {
      const delay = STREAM_INBOUND_RETRY_DELAYS_MS[attempt];
      getLogger().warn(`${this.source} inbound processing failed`, {
        error: String(error),
        retrying: delay !== undefined && this.open,
      });
      if (delay === undefined || !this.open) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.watch(
          chat,
          [adapter, threadId, message, { ...options, deduplicate: false }],
          attempt + 1,
        );
      }, delay);
      timer.unref?.();
      this.timers.add(timer);
    });
  }
}
