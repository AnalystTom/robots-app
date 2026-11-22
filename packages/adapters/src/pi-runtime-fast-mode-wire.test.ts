import { zstdDecompressSync } from "node:zlib";
import type { AgentRunRequest } from "@robots/adapter-kit";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "./pi-runtime.js";

const codexAccess = `fake.${Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } }),
).toString("base64url")}.fake`;

const chatgptSubscription: AgentRunRequest["model"] = {
  provider: "openai-codex",
  id: "gpt-6.1-sol",
  oauth: {
    credential: {
      type: "oauth",
      access: codexAccess,
      refresh: "fixture-refresh",
      expires: 9_999_999_999_999,
      accountId: "fixture-account",
    },
  },
};
const openaiApiKey: AgentRunRequest["model"] = {
  provider: "openai",
  id: "gpt-5",
  apiKey: "fixture-openai-key",
};
const anthropic: AgentRunRequest["model"] = {
  provider: "anthropic",
  id: "claude-sonnet-4-5",
  apiKey: "fixture-anthropic-key",
};

async function firstProviderRequest(model: AgentRunRequest["model"], fastMode: boolean) {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const runtime = new PiAgentRuntime({
    modelFetch: async (input, init) => {
      const request = new Request(input, init);
      const bytes = Buffer.from(await request.arrayBuffer());
      const raw =
        request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes;
      bodies.push({ url: request.url, body: JSON.parse(raw.toString()) });
      return new Response(
        JSON.stringify({ error: { message: "fixture stop", type: "invalid_request_error" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    },
  });
  try {
    for await (const _event of runtime.run(
      {
        botId: "bot",
        fastMode,
        threadId: "thread",
        runId: `run-${Math.random()}`,
        prompt: "Say ok.",
        instructions: "Answer briefly.",
        history: [],
        tools: [],
        model,
      },
      {
        operationId: "fast-mode-wire",
        traceId: "fast-mode-wire",
        spaceId: "space",
        userId: "user",
        signal: new AbortController().signal,
      },
    )) {
      if (bodies.length) break;
    }
  } catch {
    if (!bodies.length) throw new Error("The provider was not called");
  }
  const first = bodies[0];
  if (!first) throw new Error("The provider was not called");
  return first;
}

describe("fast mode on the wire", () => {
  it("asks the ChatGPT subscription for the priority tier when the bot is in fast mode", async () => {
    const sent = await firstProviderRequest(chatgptSubscription, true);
    expect(sent.url).toContain("chatgpt.com/backend-api/codex/responses");
    expect(sent.body.service_tier).toBe("priority");
  });

  it("sends no service tier to the ChatGPT subscription when fast mode is off", async () => {
    const sent = await firstProviderRequest(chatgptSubscription, false);
    expect(sent.url).toContain("chatgpt.com/backend-api/codex/responses");
    expect(sent.body).not.toHaveProperty("service_tier");
  });

  it("asks the OpenAI API for the priority tier when the bot is in fast mode", async () => {
    const sent = await firstProviderRequest(openaiApiKey, true);
    expect(sent.url).toContain("api.openai.com/v1/responses");
    expect(sent.body.service_tier).toBe("priority");
  });

  it("never sends a service tier to a provider without one, even in fast mode", async () => {
    const sent = await firstProviderRequest(anthropic, true);
    expect(sent.url).toContain("api.anthropic.com/v1/messages");
    expect(sent.body).not.toHaveProperty("service_tier");
  });
});
