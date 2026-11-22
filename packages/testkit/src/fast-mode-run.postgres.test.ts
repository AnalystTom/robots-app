import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioConnector, FakeComposioClient, PiAgentRuntime } from "@robots/adapters";
import { describe, expect, it } from "vitest";
import { discardBotIntroRun } from "./discard-bot-intro.js";
import { sessionCookieHeader } from "./index.js";
import { asSystem } from "./system-db.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const fixtureOrigin = "http://127.0.0.1:5173";

function responsesReply(text: string) {
  const events: Array<[string, Record<string, unknown>]> = [
    ["response.created", { response: { id: "resp_fixture", status: "in_progress" } }],
    [
      "response.output_item.added",
      {
        output_index: 0,
        item: { type: "message", id: "msg_fixture", role: "assistant", content: [] },
      },
    ],
    [
      "response.content_part.added",
      {
        item_id: "msg_fixture",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "" },
      },
    ],
    [
      "response.output_text.delta",
      { item_id: "msg_fixture", output_index: 0, content_index: 0, delta: text },
    ],
    [
      "response.output_item.done",
      {
        output_index: 0,
        item: {
          type: "message",
          id: "msg_fixture",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      },
    ],
    [
      "response.completed",
      {
        response: {
          id: "resp_fixture",
          status: "completed",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    ],
  ];
  return new Response(
    events
      .map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe.skipIf(!databaseAvailable)("fast mode through a real run", () => {
  it("sends the priority service tier only while the bot's fast mode is on", async () => {
    const sentToOpenAi: Array<Record<string, unknown>> = [];
    const openAiEndpoint =
      (record: (body: Record<string, unknown>) => void): typeof fetch =>
      async (input, init) => {
        const request = new Request(input, init);
        if (!request.url.startsWith("https://api.openai.com/"))
          throw new Error(`Unexpected model request to ${request.url}`);
        record(JSON.parse(await request.text()));
        return responsesReply("Fast fixture reply.");
      };
    const runtime = new PiAgentRuntime({
      modelFetch: openAiEndpoint((body) => sentToOpenAi.push(body)),
    });
    const dataDir = await mkdtemp(path.join(tmpdir(), "robots-fast-mode-"));
    let stop: (() => Promise<void>) | undefined;
    try {
      const { createApp } = await import("@robots/api/app");
      const handles = await createApp({
        databaseUrl: process.env.DATABASE_URL!,
        realtimeDatabaseUrl: process.env.DATABASE_URL!,
        authUrl: fixtureOrigin,
        webOrigin: fixtureOrigin,
        dataDir,
        sandboxProvider: "fake",
        agentRuntime: "pi",
        runtime,
        modelConnectionFetch: openAiEndpoint(() => {}),
        wakeupDriver: "memory",
        signupsEnabled: "true",
        composio: new ComposioConnector({ client: new FakeComposioClient() }),
        encryptionKey: "fast-mode-fixture-encryption-key",
      });
      stop = handles.stop;
      const signup = await handles.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: fixtureOrigin },
        body: JSON.stringify({
          email: `fast-mode-${randomUUID()}@robots.test`,
          password: "password12",
          name: "Fast fixture",
        }),
      });
      expect(signup.status).toBeLessThan(400);
      const cookie = sessionCookieHeader(signup);
      await rpc(handles.app, cookie, "models/connect", {
        provider: "openai",
        modelId: "gpt-6.1-sol",
        apiKey: "sk-fast-mode-fixture",
      });
      const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
        name: "Fast fixture",
        title: "",
        description: "",
        instructions: "Answer briefly.",
        notifyOnFinish: false,
      });
      await discardBotIntroRun(handles, cookie, bot.id);
      const updated = await rpc<{ fastMode: boolean }>(handles.app, cookie, "bots/update", {
        botId: bot.id,
        modelProvider: "openai",
        modelId: "gpt-6.1-sol",
        fastMode: true,
      });
      expect(updated.fastMode).toBe(true);

      const sendAndWait = async (text: string) => {
        const before = sentToOpenAi.length;
        const sent = await rpc<{ runId: string }>(handles.app, cookie, "threads/send", {
          botId: bot.id,
          text,
        });
        await expect
          .poll(
            async () =>
              (
                await asSystem(handles.prisma).run.findUnique({
                  where: { id: sent.runId },
                  select: { status: true },
                })
              )?.status,
            { timeout: 20_000, interval: 100 },
          )
          .toBe("completed");
        return sentToOpenAi.slice(before);
      };

      const fastRequests = await sendAndWait("Say hi quickly.");
      expect(fastRequests.length).toBeGreaterThan(0);
      for (const body of fastRequests) {
        expect(body.model).toBe("gpt-6.1-sol");
        expect(body.service_tier).toBe("priority");
      }

      await rpc(handles.app, cookie, "bots/update", { botId: bot.id, fastMode: false });
      const normalRequests = await sendAndWait("Say hi normally.");
      expect(normalRequests.length).toBeGreaterThan(0);
      for (const body of normalRequests) expect(body).not.toHaveProperty("service_tier");
    } finally {
      try {
        await stop?.();
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json?: T; error?: { message?: string } };
  if (response.status >= 400 || body.error)
    throw new Error(`${procedure}: ${response.status} ${JSON.stringify(body)}`);
  return body.json as T;
}
