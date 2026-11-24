import { createMemoryState } from "@chat-adapter/state-memory";
import type { AdapterContext, MessagingInboundEvent } from "@robots/adapter-kit";
import { Chat, Message, parseMarkdown } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSdkMessagingSurface, MessagingSendError } from "./chat-sdk-surface.js";
import {
  DISCORD_GATEWAY_RECONNECT_DELAYS_MS,
  DISCORD_GATEWAY_STABLE_MS,
  DISCORD_MESSAGE_LIMIT,
  DISCORD_UPLOAD_MAX_BYTES,
  discordGatewayAdvice,
  keepGatewayOpen,
} from "./discord/adapter.js";
import type { MessagingEnvironmentValues } from "./messaging-platforms.js";
import {
  discordBotFromEnv,
  messagingEnvFromProcess,
  messagingPlatformsFromEnv,
  splitOutboundBody,
} from "./messaging-platforms.js";
import { STREAM_INBOUND_RETRY_DELAYS_MS, StreamInboundRetries } from "./stream-inbound-retries.js";

const APPLICATION_ID = "123456789012345678";
const BOT_TOKEN = `${Buffer.from(APPLICATION_ID).toString("base64url")}.GabcDe.${"x".repeat(38)}`;
const DM_CHANNEL = "998877665544332211";
const USER_ID = "112233445566778899";
const THREAD_ID = `discord:@me:${DM_CHANNEL}`;

const context: AdapterContext = {
  operationId: "op-test",
  traceId: "trace-test",
  spaceId: "space-test",
  userId: "user-test",
  signal: new AbortController().signal,
};

const env: MessagingEnvironmentValues = {
  discordBot: { botToken: BOT_TOKEN, applicationId: APPLICATION_ID },
};

interface DiscordRequest {
  method: string;
  path: string;
  authorization: string | null;
  json?: { content?: string };
  form?: FormData;
}

function stubDiscordApi(failures: { status: number; body: unknown }[] = []) {
  const requests: DiscordRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      if (url.origin !== "https://discord.com") throw new Error(`Unexpected request: ${input}`);
      const headers = new Headers(init.headers);
      const request: DiscordRequest = {
        method: init.method ?? "GET",
        path: url.pathname.replace("/api/v10", ""),
        authorization: headers.get("authorization"),
      };
      if (init.body instanceof FormData) request.form = init.body;
      else if (typeof init.body === "string") request.json = JSON.parse(init.body);
      requests.push(request);
      const failure = failures.shift();
      if (failure) return Response.json(failure.body, { status: failure.status });
      if (request.path.endsWith("/typing")) return new Response(null, { status: 204 });
      if (request.path === "/users/@me/channels") return Response.json({ id: DM_CHANNEL, type: 1 });
      return Response.json({
        id: `sent-${requests.length}`,
        channel_id: DM_CHANNEL,
        content: request.json?.content ?? "",
      });
    }),
  );
  return requests;
}

function gatewayMessage(fields: {
  guildId?: string | null;
  content: string;
  attachments?: { url: string; name: string; contentType: string; size: number }[];
}) {
  return {
    id: "1300000000000000001",
    guildId: fields.guildId ?? null,
    channelId: DM_CHANNEL,
    channel: { isThread: () => false },
    content: fields.content,
    author: { id: USER_ID, username: "ada", displayName: "Ada Lovelace", bot: false },
    attachments: new Map((fields.attachments ?? []).map((file) => [file.url, file])),
    createdAt: new Date("2026-11-19T10:00:00.000Z"),
    editedAt: null,
  };
}

async function receiveOverGateway(message: ReturnType<typeof gatewayMessage>) {
  const platforms = messagingPlatformsFromEnv(env);
  const surface = new ChatSdkMessagingSurface(platforms);
  const events: MessagingInboundEvent[] = [];
  surface.onInbound(async (event) => {
    events.push(event);
  });
  await surface.initialize();
  const adapter = platforms[0]!.adapter as unknown as {
    handleGatewayMessage(message: unknown, isMentioned: boolean): Promise<void>;
  };
  await adapter.handleGatewayMessage(message, false);
  await surface.shutdown();
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Discord configuration", () => {
  it("is off when neither setting is present", () => {
    expect(discordBotFromEnv({})).toBeUndefined();
    expect(messagingPlatformsFromEnv(messagingEnvFromProcess({}))).toEqual([]);
  });

  it("reads the bot token and application id, trimmed", () => {
    expect(
      discordBotFromEnv({
        DISCORD_BOT_TOKEN: ` ${BOT_TOKEN} `,
        DISCORD_APPLICATION_ID: ` ${APPLICATION_ID}\n`,
      }),
    ).toEqual({ botToken: BOT_TOKEN, applicationId: APPLICATION_ID });
  });

  it("rejects a half-configured bot at startup", () => {
    expect(() => messagingEnvFromProcess({ DISCORD_BOT_TOKEN: BOT_TOKEN })).toThrow(
      "Discord needs both DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID",
    );
    expect(() => discordBotFromEnv({ DISCORD_APPLICATION_ID: APPLICATION_ID })).toThrow(
      "Discord needs both DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID",
    );
  });

  it("rejects an application id that is not a Discord snowflake", () => {
    expect(() =>
      discordBotFromEnv({ DISCORD_BOT_TOKEN: BOT_TOKEN, DISCORD_APPLICATION_ID: "my-app" }),
    ).toThrow("DISCORD_APPLICATION_ID must be the numeric Application ID");
  });

  it.each([
    ["the public key", "a".repeat(64)],
    ["the client secret", "AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    ["a token with its header prefix", `Bot ${BOT_TOKEN}`],
  ])("rejects %s pasted as the bot token", (_label, token) => {
    expect(() =>
      discordBotFromEnv({ DISCORD_BOT_TOKEN: token, DISCORD_APPLICATION_ID: APPLICATION_ID }),
    ).toThrow("DISCORD_BOT_TOKEN is not a Discord bot token");
  });

  it("mounts Discord for direct messages with typing receipts and files", () => {
    const [platform] = messagingPlatformsFromEnv(env);
    expect(platform).toMatchObject({
      provider: "discord",
      capabilities: { direct: true, groups: false, receipt: "typing", files: true },
    });
  });
});

describe("Discord inbound", () => {
  beforeEach(() => {
    stubDiscordApi();
  });

  it("turns a direct message from the gateway into a direct inbound message", async () => {
    const events = await receiveOverGateway(
      gatewayMessage({
        content: "Hello **bot**",
        attachments: [
          {
            url: "https://cdn.discordapp.com/attachments/1/2/photo.png",
            name: "photo.png",
            contentType: "image/png",
            size: 2048,
          },
        ],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "message",
      provider: "discord",
      handle: "1300000000000000001",
      threadId: THREAD_ID,
      isDirect: true,
      from: USER_ID,
      fromLabel: "Ada Lovelace",
      content: "Hello **bot**",
      mediaUrl: "https://cdn.discordapp.com/attachments/1/2/photo.png",
      attachments: [
        expect.objectContaining({ name: "photo.png", mimeType: "image/png", size: 2048 }),
      ],
    });
  });

  it("ignores server channel messages without creating a Discord thread", async () => {
    const requests = stubDiscordApi();
    const events = await receiveOverGateway(
      gatewayMessage({ guildId: "555555555555555555", content: "<@123> hi" }),
    );
    expect(events).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("retries a gateway delivery whose processing fails, then gives up", async () => {
    vi.useFakeTimers();
    const retries = new StreamInboundRetries("discord");
    const handler = vi.fn(async () => {
      throw new Error("sink down");
    });
    const adapter = messagingPlatformsFromEnv(env)[0]!.adapter;
    const chat = new Chat({
      userName: "robots",
      adapters: { discord: adapter },
      state: createMemoryState(),
      concurrency: "concurrent",
    });
    chat.onDirectMessage(handler);
    await chat.initialize();
    const wrapped = retries.wrap(chat as never);
    const message = new Message({
      id: "1300000000000000002",
      threadId: THREAD_ID,
      text: "hello",
      formatted: parseMarkdown("hello"),
      author: { userId: USER_ID, userName: "ada", fullName: "Ada", isBot: false, isMe: false },
      metadata: { dateSent: new Date(), edited: false },
      attachments: [],
      raw: {},
    });
    await expect(wrapped.handleIncomingMessage(adapter, THREAD_ID, message)).rejects.toThrow(
      "sink down",
    );
    for (const delay of STREAM_INBOUND_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    expect(handler).toHaveBeenCalledTimes(1 + STREAM_INBOUND_RETRY_DELAYS_MS.length);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(handler).toHaveBeenCalledTimes(1 + STREAM_INBOUND_RETRY_DELAYS_MS.length);
    retries.stop();
  });
});

describe("Discord outbound", () => {
  it("posts a reply to the direct message channel as Discord Markdown", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    const body = "**Done.** See [the plan](https://example.com/plan) and `notes.md`.";
    const sent = await surface.sendToThread({ threadId: THREAD_ID, body }, context);
    expect(sent).toEqual({ handle: "sent-1" });
    expect(requests).toEqual([
      {
        method: "POST",
        path: `/channels/${DM_CHANNEL}/messages`,
        authorization: `Bot ${BOT_TOKEN}`,
        json: { content: body },
      },
    ]);
  });

  it("keeps @names in a reply as written instead of turning them into broken mentions", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    await surface.sendToThread({ threadId: THREAD_ID, body: "Ask @ada about it" }, context);
    expect(requests[0]!.json).toEqual({ content: "Ask @ada about it" });
  });

  it("splits a long reply into parts Discord accepts whole, in order", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    const code = "def area(r):\n    return 3.14159 * r * r";
    const paragraphs = Array.from(
      { length: 90 },
      (_, index) => `Paragraph ${index} explains one more step of the reply in plain words.`,
    );
    const body = [
      paragraphs.slice(0, 45).join("\n\n"),
      `\`\`\`python\n${code}\n\`\`\``,
      paragraphs.slice(45).join("\n\n"),
    ].join("\n\n");
    expect(body.length).toBeGreaterThan(DISCORD_MESSAGE_LIMIT * 2);

    const parts = splitOutboundBody("discord", body);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) {
      await surface.sendToThread({ threadId: THREAD_ID, body: part }, context);
    }

    const contents = requests.map((request) => request.json!.content!);
    expect(contents).toEqual(parts);
    for (const content of contents) {
      expect(content.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
      expect(content.endsWith("...")).toBe(false);
    }
    const delivered = contents.join("\n\n");
    for (const paragraph of paragraphs) expect(delivered).toContain(paragraph);
    expect(
      contents.filter((content) => content.includes(`\`\`\`python\n${code}\n\`\`\``)),
    ).toHaveLength(1);
    expect(contents.join("").indexOf("Paragraph 89")).toBeGreaterThan(
      contents.join("").indexOf("Paragraph 0"),
    );
  });

  it("splits a single block longer than one message", () => {
    const parts = splitOutboundBody("discord", "word ".repeat(1500).trim());
    expect(parts.length).toBe(4);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(parts.join(" ").split(/\s+/)).toHaveLength(1500);
  });

  it("leaves a reply that fits one message as written", () => {
    const body = `# Summary\n\n${"a".repeat(DISCORD_MESSAGE_LIMIT - 11)}`;
    expect(body.length).toBe(DISCORD_MESSAGE_LIMIT);
    expect(splitOutboundBody("discord", body)).toEqual([body]);
    expect(splitOutboundBody("discord", " \n ")).toEqual([]);
  });

  it("uploads a file with its caption", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    await surface.sendToThread(
      {
        threadId: THREAD_ID,
        body: "Here is the chart",
        attachment: {
          name: "chart.png",
          mimeType: "image/png",
          data: new Uint8Array([137, 80, 78, 71]),
        },
      },
      context,
    );
    expect(requests).toHaveLength(1);
    const { method, path, form } = requests[0]!;
    expect({ method, path }).toEqual({ method: "POST", path: `/channels/${DM_CHANNEL}/messages` });
    expect(JSON.parse(String(form!.get("payload_json")))).toEqual({ content: "Here is the chart" });
    const file = form!.get("files[0]") as File;
    expect(file.name).toBe("chart.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("refuses a file larger than Discord accepts without retrying", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    const sending = surface.sendToThread(
      {
        threadId: THREAD_ID,
        body: "",
        attachment: {
          name: "video.mp4",
          mimeType: "video/mp4",
          data: new Uint8Array(DISCORD_UPLOAD_MAX_BYTES + 1),
        },
      },
      context,
    );
    await expect(sending).rejects.toMatchObject({
      name: "MessagingSendError",
      permanent: true,
      message: "File is larger than Discord accepts",
    });
    expect(requests).toEqual([]);
  });

  it.each([
    [403, true, { code: 50007, message: "Cannot send messages to this user" }],
    [404, true, { code: 10003, message: "Unknown Channel" }],
    [500, false, { message: "Internal Server Error" }],
  ])("treats a %i send failure as permanent: %s", async (status, permanent, body) => {
    stubDiscordApi([{ status, body }]);
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    const error = await surface
      .sendToThread({ threadId: THREAD_ID, body: "hello" }, context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MessagingSendError);
    expect((error as MessagingSendError).permanent).toBe(permanent);
  });

  it("shows typing as the receipt for an inbound message", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    await surface.acknowledge(THREAD_ID, "1300000000000000001", context);
    expect(requests).toEqual([
      {
        method: "POST",
        path: `/channels/${DM_CHANNEL}/typing`,
        authorization: `Bot ${BOT_TOKEN}`,
      },
    ]);
  });

  it("opens a direct message channel for a linked Discord user", async () => {
    const requests = stubDiscordApi();
    const surface = new ChatSdkMessagingSurface(messagingPlatformsFromEnv(env));
    await expect(surface.openDirectThread("discord", USER_ID, context)).resolves.toBe(
      `discord:@me:${DM_CHANNEL}`,
    );
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/users/@me/channels",
      json: { recipient_id: USER_ID },
    });
  });
});

describe("Discord gateway", () => {
  it("reconnects at once after a long session and backs off while connecting fails", async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    const sessions: number[] = [];
    let healthy = true;
    const connect = vi.fn(async () => {
      sessions.push(Date.now());
      if (healthy) await new Promise((resolve) => setTimeout(resolve, DISCORD_GATEWAY_STABLE_MS));
    });
    const running = keepGatewayOpen(connect, stop.signal);
    await vi.advanceTimersByTimeAsync(DISCORD_GATEWAY_STABLE_MS);
    expect(connect).toHaveBeenCalledTimes(2);

    healthy = false;
    await vi.advanceTimersByTimeAsync(DISCORD_GATEWAY_STABLE_MS);
    const failedAt = sessions.length;
    for (const delay of DISCORD_GATEWAY_RECONNECT_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      const before = connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(connect.mock.calls.length).toBe(before + 1);
    }
    const lastDelay = DISCORD_GATEWAY_RECONNECT_DELAYS_MS.at(-1)!;
    await vi.advanceTimersByTimeAsync(lastDelay);
    expect(connect.mock.calls.length).toBe(
      failedAt + DISCORD_GATEWAY_RECONNECT_DELAYS_MS.length + 1,
    );

    stop.abort();
    await running;
    await vi.advanceTimersByTimeAsync(lastDelay * 3);
    expect(connect.mock.calls.length).toBe(
      failedAt + DISCORD_GATEWAY_RECONNECT_DELAYS_MS.length + 1,
    );
  });

  it("explains the gateway errors an operator can fix", () => {
    expect(discordGatewayAdvice("Error: Used disallowed intents")).toContain(
      "Turn on Message Content Intent",
    );
    expect(discordGatewayAdvice("Error [TokenInvalid]: An invalid token was provided.")).toContain(
      "Discord rejected DISCORD_BOT_TOKEN",
    );
    expect(discordGatewayAdvice("Error: socket hang up")).toBeUndefined();
  });
});
