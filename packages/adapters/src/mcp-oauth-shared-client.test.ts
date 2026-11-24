import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthMaterial, SharedMcpOAuthClient } from "./mcp-oauth.js";
import {
  googleMcpOAuthClientFromEnv,
  McpOAuthBroker,
  McpOAuthClientRequiredError,
} from "./mcp-oauth.js";
import { MCP_DYNAMIC_REGISTRATION_UNSUPPORTED, mcpServerHealthDto } from "./mcp-server-health.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GOOGLE = "https://accounts.google.com";
const OTHER_AUTH = "https://auth.example.test";
const ENDPOINT = "https://gmail.example.test/mcp";
const REDIRECT = "https://app.example.test/mcp/oauth/callback";
const CONTEXT = { spaceId: "space-1", userId: "user-1" };
const SHARED: SharedMcpOAuthClient = {
  client_id: "shared-client.apps.googleusercontent.com",
  client_secret: "shared-google-secret-value",
};
const OWN_CLIENT = { client_id: "own-client", client_secret: "own-client-secret" };

const NETWORK = {
  fetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
  resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }],
};

function hrefOf(input: string | URL | Request, init?: RequestInit): string {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? String(input) : input.url,
  );
  const host = new Headers(input instanceof Request ? input.headers : init?.headers).get("host");
  if (host) url.host = host;
  return url.href;
}

function authServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  };
}

type TokenRequest = { clientId: string | null; clientSecret: string | null; body: URLSearchParams };

function tokenRequestOf(request: Request, body: URLSearchParams): TokenRequest {
  const basic = request.headers.get("authorization")?.match(/^Basic (.+)$/)?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, "base64").toString().split(":");
    return {
      clientId: decodeURIComponent(id ?? ""),
      clientSecret: decodeURIComponent(secret ?? ""),
      body,
    };
  }
  return { clientId: body.get("client_id"), clientSecret: body.get("client_secret"), body };
}

function googleLikeServer(
  authServer: string,
  onToken: (request: TokenRequest) => Response | undefined = () => undefined,
) {
  const requested: string[] = [];
  const tokenRequests: TokenRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = hrefOf(input, init);
      requested.push(`${request.method} ${url}`);
      if (url === ENDPOINT && request.method === "POST") {
        const message = (await request.json()) as { id?: number; method: string };
        if (message.method !== "initialize") return new Response(null, { status: 202 });
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "gmail", version: "1" },
          },
        });
      }
      if (url === "https://gmail.example.test/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          resource: ENDPOINT,
          authorization_servers: [authServer],
          scopes_supported: ["https://www.googleapis.com/auth/gmail.readonly"],
        });
      }
      if (url === `${authServer}/.well-known/oauth-authorization-server`) {
        return Response.json(authServerMetadata(authServer));
      }
      if (url === `${authServer}/token` && request.method === "POST") {
        const token = tokenRequestOf(request, new URLSearchParams(await request.text()));
        tokenRequests.push(token);
        const rejected = onToken(token);
        if (rejected) return rejected;
        return Response.json({
          access_token: `access-${tokenRequests.length}`,
          refresh_token: `refresh-${tokenRequests.length}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return { requested, tokenRequests };
}

function inMemoryDeployment(initial: OAuthMaterial) {
  const plaintexts = new Map<string, string>();
  let nextRecord = 0;
  const secrets = {
    put: vi.fn(async (plaintext: string) => {
      nextRecord += 1;
      plaintexts.set(`cipher-${nextRecord}`, plaintext);
      return { id: `secret-${nextRecord}`, ciphertext: `cipher-${nextRecord}` };
    }),
    load: vi.fn(async (ciphertext: string) => {
      const value = plaintexts.get(ciphertext);
      if (value === undefined) throw new Error("secret not found");
      return value;
    }),
    delete: vi.fn(async (ciphertext: string) => {
      plaintexts.delete(ciphertext);
    }),
  };
  const rows: Array<{ id: string; ciphertext: string }> = [];
  const sessions: Array<Record<string, unknown> & { id: string; createdAt: Date }> = [];
  const server = {
    id: "server-1",
    endpoint: ENDPOINT,
    secretId: null as string | null,
    revision: 1,
  };
  const tables = {
    mcpServer: {
      findFirst: async () => ({ ...server }),
      update: async ({
        data,
      }: {
        data: { secretId?: string | null; revision?: { increment: number } };
      }) => {
        if (data.secretId !== undefined) server.secretId = data.secretId;
        if (data.revision) server.revision += data.revision.increment;
        return { ...server };
      },
    },
    mcpServerSpace: { count: async () => 0 },
    secret: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: { id: string; ciphertext: string } }) => {
        rows.push({ id: data.id, ciphertext: data.ciphertext });
        return data;
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((row) => row.id === where.id);
        if (index >= 0) rows.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      },
      count: async ({ where }: { where: { ciphertext: string } }) =>
        rows.filter((row) => row.ciphertext === where.ciphertext).length,
    },
    botSecret: { count: async () => 0 },
    vaultCredential: { count: async () => 0 },
    integrationProviderConfig: { count: async () => 0 },
    mcpOAuthSession: {
      count: async () => sessions.length,
      findFirst: async ({ where }: { where: { id: string } }) =>
        sessions.find((session) => session.id === where.id) ?? null,
      create: async ({ data }: { data: { id: string } }) => {
        sessions.push({ ...data, createdAt: new Date() });
        return data;
      },
      deleteMany: async ({ where }: { where: { id?: string; createdAt?: { lt: Date } } }) => {
        const doomed = sessions.filter((session) =>
          where.createdAt ? session.createdAt < where.createdAt.lt : session.id === where.id,
        );
        for (const session of doomed) sessions.splice(sessions.indexOf(session), 1);
        return { count: doomed.length };
      },
    },
  };
  const prisma = {
    ...tables,
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback({ ...tables, $queryRaw: async () => [], $executeRaw: async () => 1 }),
  };
  const seed = JSON.stringify(initial);
  plaintexts.set("cipher-0", seed);
  rows.push({ id: "secret-0", ciphertext: "cipher-0" });
  server.secretId = "secret-0";
  return {
    server,
    broker: (googleClient: SharedMcpOAuthClient | undefined) =>
      new McpOAuthBroker(prisma as never, secrets as never, NETWORK, false, googleClient),
    stored: async (): Promise<OAuthMaterial> => {
      const row = rows.find((candidate) => candidate.id === server.secretId);
      return row ? (JSON.parse(plaintexts.get(row.ciphertext) ?? "{}") as OAuthMaterial) : {};
    },
    everyWrite: () => (secrets.put.mock.calls as unknown[][]).map((call) => String(call[0])),
  };
}

function googleDiscovery(issuer = GOOGLE) {
  return {
    authorizationServerUrl: issuer,
    authorizationServerMetadata: authServerMetadata(issuer),
    resourceMetadata: { resource: ENDPOINT, authorization_servers: [issuer] },
  };
}

async function beginFlow(deployment: ReturnType<typeof inMemoryDeployment>, shared = SHARED) {
  const broker = deployment.broker(shared);
  const started = await broker.begin({ serverId: "server-1", ...CONTEXT, redirectUri: REDIRECT });
  if (started.status !== "authorization_required") throw new Error(started.status);
  return { broker, started, authorizationUrl: new URL(started.authorizationUrl) };
}

describe("shared Google MCP OAuth client", () => {
  it("connects a Google-authorized server with the deployment client when none is stored", async () => {
    const network = googleLikeServer(GOOGLE);
    const deployment = inMemoryDeployment({});

    const { broker, started, authorizationUrl } = await beginFlow(deployment);

    expect(authorizationUrl.origin).toBe(GOOGLE);
    expect(authorizationUrl.searchParams.get("client_id")).toBe(SHARED.client_id);
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(network.requested.some((request) => request.includes("/register"))).toBe(false);

    await broker.complete({
      sessionId: started.sessionId,
      state: started.sessionId,
      code: "authorization-code",
      ...CONTEXT,
    });

    expect(network.tokenRequests).toHaveLength(1);
    expect(network.tokenRequests[0]).toMatchObject({
      clientId: SHARED.client_id,
      clientSecret: SHARED.client_secret,
    });
    const stored = await deployment.stored();
    expect(stored.oauth?.tokens?.refresh_token).toBe("refresh-1");
    expect(stored.oauthClient).toBeUndefined();
    expect(stored.oauth?.clientInformation).toBeUndefined();
  });

  it("never writes the deployment client into any stored material", async () => {
    googleLikeServer(GOOGLE);
    const deployment = inMemoryDeployment({});

    const { broker, started } = await beginFlow(deployment);
    await broker.complete({
      sessionId: started.sessionId,
      state: started.sessionId,
      code: "authorization-code",
      ...CONTEXT,
    });

    const writes = deployment.everyWrite();
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).not.toContain(SHARED.client_secret);
      expect(write).not.toContain(SHARED.client_id);
    }
    const summary = await broker.summaryFor(deployment.server, CONTEXT);
    expect(summary).toEqual({
      status: "connected",
      clientId: null,
      sharedClient: true,
      credential: true,
    });
    expect(JSON.stringify(summary)).not.toContain(SHARED.client_secret);
  });

  it("uses the server's own client over the deployment client", async () => {
    const network = googleLikeServer(GOOGLE);
    const deployment = inMemoryDeployment({ oauthClient: OWN_CLIENT });

    const { broker, started, authorizationUrl } = await beginFlow(deployment);
    await broker.complete({
      sessionId: started.sessionId,
      state: started.sessionId,
      code: "authorization-code",
      ...CONTEXT,
    });

    expect(authorizationUrl.searchParams.get("client_id")).toBe(OWN_CLIENT.client_id);
    expect(authorizationUrl.searchParams.get("access_type")).toBeNull();
    expect(network.tokenRequests[0]).toMatchObject({
      clientId: OWN_CLIENT.client_id,
      clientSecret: OWN_CLIENT.client_secret,
    });
    expect((await deployment.stored()).oauthClient).toMatchObject(OWN_CLIENT);
    expect(await broker.summaryFor(deployment.server, CONTEXT)).toMatchObject({
      clientId: OWN_CLIENT.client_id,
      sharedClient: false,
    });
  });

  it("does not offer the deployment client to an authorization server other than Google", async () => {
    const network = googleLikeServer(OTHER_AUTH);
    const deployment = inMemoryDeployment({});
    const broker = deployment.broker(SHARED);

    const error = await broker
      .begin({ serverId: "server-1", ...CONTEXT, redirectUri: REDIRECT })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(McpOAuthClientRequiredError);
    expect(network.requested.join("\n")).not.toContain(SHARED.client_id);
    expect(await broker.summaryFor(deployment.server, CONTEXT)).toMatchObject({
      sharedClient: false,
    });
  });

  it("still asks for a client from Google when no deployment client is configured", async () => {
    googleLikeServer(GOOGLE);
    const deployment = inMemoryDeployment({});

    await expect(
      deployment
        .broker(undefined)
        .begin({ serverId: "server-1", ...CONTEXT, redirectUri: REDIRECT }),
    ).rejects.toBeInstanceOf(McpOAuthClientRequiredError);
  });

  it("refreshes a Google grant with the deployment client", async () => {
    const network = googleLikeServer(GOOGLE);
    const deployment = inMemoryDeployment({
      oauth: {
        redirectUri: REDIRECT,
        tokens: {
          access_token: "expired-access",
          refresh_token: "held-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        },
        obtainedAt: Date.now() - 3 * 60 * 60 * 1000,
        discoveryState: googleDiscovery(),
      },
    });
    const broker = deployment.broker(SHARED);
    const provider = await broker.providerFor(deployment.server, CONTEXT);

    await expect(provider?.tokens()).resolves.toMatchObject({ access_token: "access-1" });

    expect(network.tokenRequests).toHaveLength(1);
    expect(network.tokenRequests[0]).toMatchObject({
      clientId: SHARED.client_id,
      clientSecret: SHARED.client_secret,
    });
    expect(network.tokenRequests[0]?.body.get("refresh_token")).toBe("held-refresh");
    const stored = await deployment.stored();
    expect(stored.oauth?.tokens?.refresh_token).toBe("refresh-1");
    expect(JSON.stringify(stored)).not.toContain(SHARED.client_secret);
  });

  it("redacts the deployment client secret from errors and tool output", async () => {
    googleLikeServer(GOOGLE, () =>
      Response.json(
        { error: "invalid_client", error_description: `bad secret ${SHARED.client_secret}` },
        { status: 401 },
      ),
    );
    const deployment = inMemoryDeployment({});

    const { broker, started } = await beginFlow(deployment);
    const error = await broker
      .complete({
        sessionId: started.sessionId,
        state: started.sessionId,
        code: "authorization-code",
        ...CONTEXT,
      })
      .then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );

    expect(error?.message).toContain("Could not complete MCP OAuth");
    expect(error?.message).not.toContain(SHARED.client_secret);
    expect(broker.secretsIn({})).toContain(SHARED.client_secret);
    expect(deployment.broker(undefined).secretsIn({})).toEqual([]);
  });

  it("stops reporting a stale client-required health once the deployment client covers it", () => {
    const row = {
      healthStatus: "error",
      healthMessage: `Could not start MCP OAuth: ${MCP_DYNAMIC_REGISTRATION_UNSUPPORTED}`,
      healthToolCount: null,
      healthCheckedAt: new Date(),
    };

    expect(mcpServerHealthDto(row).code).toBe("MCP_OAUTH_CLIENT_REQUIRED");
    expect(mcpServerHealthDto(row, { sharedClient: true })).toEqual({
      status: "unknown",
      message: null,
      code: null,
      toolCount: null,
      checkedAt: null,
    });
  });
});

describe("googleMcpOAuthClientFromEnv", () => {
  it("reads the pair, or nothing when neither is set", () => {
    expect(
      googleMcpOAuthClientFromEnv({
        GOOGLE_MCP_OAUTH_CLIENT_ID: " id ",
        GOOGLE_MCP_OAUTH_CLIENT_SECRET: "secret",
      }),
    ).toEqual({ client_id: "id", client_secret: "secret" });
    expect(googleMcpOAuthClientFromEnv({})).toBeUndefined();
  });

  it("refuses half a pair and ignores the sign-in client", () => {
    expect(() => googleMcpOAuthClientFromEnv({ GOOGLE_MCP_OAUTH_CLIENT_ID: "id" })).toThrow(
      "must be configured together",
    );
    expect(
      googleMcpOAuthClientFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    ).toBeUndefined();
  });
});
