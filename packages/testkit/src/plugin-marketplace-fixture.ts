import type { PluginRepoFetcher, PluginTextReader } from "@robots/adapters";

import { REMOTE_MCP_APPS } from "@robots/core";

export const MARKETPLACE_FIXTURE_SOURCE = "https://github.com/example/plugin-marketplace-fixture";
export const MARKETPLACE_FIXTURE_ENDPOINT = "https://marketplace-tools.example.test/mcp";
export const MARKETPLACE_FIXTURE_AUTH = "https://marketplace-auth.example.test";

const resources = [MARKETPLACE_FIXTURE_ENDPOINT, ...REMOTE_MCP_APPS.map((app) => app.endpoint)].map(
  (value) => new URL(value),
);

const CURSOR_REPO = "https://github.com/cursor/plugins";
const CURSOR_RAW = "https://raw.githubusercontent.com/cursor/plugins/HEAD/";
const fixtureMcp = JSON.stringify({
  mcpServers: { notes: { type: "http", url: MARKETPLACE_FIXTURE_ENDPOINT } },
});
const CURSOR_FILES: Record<string, string> = {
  "planning-notes/.cursor-plugin/plugin.json": JSON.stringify({
    name: "planning-notes",
    displayName: "Planning Notes",
  }),
  "planning-notes/mcp.json": fixtureMcp,
  "planning-notes/skills/planning-notes/SKILL.md":
    "---\nname: planning-notes\ndescription: Organize a daily plan\n---\n\nUse the notes integration to record the plan.\n",
  "stripe/.cursor-plugin/plugin.json": JSON.stringify({
    name: "stripe",
    displayName: "Stripe",
  }),
  "stripe/mcp.json": fixtureMcp,
  "review-kit/.cursor-plugin/plugin.json": JSON.stringify({
    name: "review-kit",
    displayName: "Review Kit",
  }),
  "review-kit/agents/reviewer.md":
    "---\nname: reviewer\ndescription: Reviews a draft for gaps\n---\n\nList what is missing.\n",
  "review-kit/commands/review.md":
    "---\ndescription: Review the current draft\n---\n\nReview $ARGUMENTS.\n",
};

export class PluginMarketplaceFixture {
  readonly calls: string[] = [];
  readonly repo: PluginRepoFetcher = async (source) => {
    if (source.gitUrl === CURSOR_REPO)
      return {
        resolvedSha: "f".repeat(40),
        files: Object.entries(CURSOR_FILES).map(([path, content]) => ({ path, content })),
      };
    if (source.gitUrl !== MARKETPLACE_FIXTURE_SOURCE) throw new Error("Unknown fixture repository");
    return {
      resolvedSha: "e".repeat(40),
      files: [
        {
          path: ".cursor-plugin/plugin.json",
          content: JSON.stringify({ name: "imported-notes", description: "Notes from GitHub" }),
        },
        { path: "mcp.json", content: fixtureMcp },
        {
          path: "skills/imported-notes/SKILL.md",
          content:
            "---\nname: imported-notes\ndescription: Keep imported notes\n---\n\nRecord notes.\n",
        },
        { path: "hooks/hooks.json", content: "{}" },
      ],
    };
  };
  readonly index: PluginTextReader = async (url) => {
    if (url === `${CURSOR_RAW}.cursor-plugin/marketplace.json`)
      return JSON.stringify({
        name: "cursor-fixture",
        plugins: [
          {
            name: "planning-notes",
            source: "planning-notes",
            description: "Plan work and write notes from Cursor.",
            keywords: ["planning"],
            category: "productivity",
          },
          { name: "review-kit", source: "review-kit", description: "Review drafts" },
          {
            name: "stripe",
            source: "stripe",
            description: "Stripe development plugin for Cursor: payments and subscriptions.",
            category: "finance",
          },
        ],
      });
    if (url.startsWith("https://api.github.com/repos/cursor/plugins/git/trees/"))
      return JSON.stringify({
        tree: Object.keys(CURSOR_FILES).map((path) => ({ path, type: "blob" })),
      });
    if (url.startsWith(CURSOR_RAW)) {
      const content = CURSOR_FILES[url.slice(CURSOR_RAW.length)];
      if (content !== undefined) return content;
    }
    if (url.includes("/xai-org/plugin-marketplace/")) {
      if (url.endsWith("plugin-index.json")) return JSON.stringify({ version: 1, plugins: {} });
      return JSON.stringify({ name: "xai-fixture", plugins: [] });
    }
    throw new Error("Unknown fixture registry");
  };
  constructor(private readonly fallback: typeof globalThis.fetch) {}
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const host = headers.get("host");
    if (
      host &&
      (host.endsWith(".example.test") || resources.some((resource) => resource.host === host))
    )
      url.host = host;
    const resource = resources.find(
      (item) =>
        item.origin === url.origin &&
        (item.pathname === url.pathname ||
          `/.well-known/oauth-protected-resource${item.pathname}` === url.pathname),
    );
    if (!resource && url.origin !== MARKETPLACE_FIXTURE_AUTH) return this.fallback(input, init);
    const request = new Request(input, init);
    const bodyText = await request.text();
    this.calls.push(`${request.method} ${url.pathname}`);
    if (resource && url.pathname !== resource.pathname)
      return Response.json({
        resource: resource.href,
        authorization_servers: [MARKETPLACE_FIXTURE_AUTH],
      });
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return Response.json({
        issuer: MARKETPLACE_FIXTURE_AUTH,
        authorization_endpoint: `${MARKETPLACE_FIXTURE_AUTH}/authorize`,
        token_endpoint: `${MARKETPLACE_FIXTURE_AUTH}/token`,
        registration_endpoint: `${MARKETPLACE_FIXTURE_AUTH}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.pathname === "/register") {
      const metadata = bodyText ? JSON.parse(bodyText) : {};
      return Response.json({
        ...metadata,
        client_id: crypto.randomUUID(),
        token_endpoint_auth_method: "none",
      });
    }
    if (url.pathname === "/token") {
      const body = new URLSearchParams(bodyText);
      if (!body.get("code_verifier") && body.get("grant_type") !== "refresh_token")
        return new Response("Missing PKCE verifier", { status: 400 });
      return Response.json({
        access_token: "fake-marketplace-access",
        refresh_token: "fake-marketplace-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (resource && url.pathname === resource.pathname) {
      if (headers.get("authorization") !== "Bearer fake-marketplace-access")
        return new Response("Authorization required", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}"`,
          },
        });
      const rpcRequest = bodyText ? JSON.parse(bodyText) : {};
      const result = (value: unknown) =>
        Response.json({ jsonrpc: "2.0", id: rpcRequest.id, result: value });
      if (rpcRequest.method === "initialize")
        return result({
          protocolVersion: rpcRequest.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "marketplace-fixture", version: "1.0.0" },
        });
      if (rpcRequest.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (rpcRequest.method === "tools/list")
        return result({
          tools: [
            {
              name: "notes.write",
              description: "Write a note",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        });
      if (rpcRequest.method === "tools/call")
        return result({
          content: [{ type: "text", text: "Note saved" }],
          structuredContent: { ok: true },
        });
      return new Response(null, { status: 202 });
    }
    return new Response(null, { status: 404 });
  };
}
