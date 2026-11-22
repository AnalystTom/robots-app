import type { McpServer, RobotsDesktop } from "@robots/contracts";
import { deadlineSignal, REMOTE_APP_NATIVE_CALLBACK, withAbort } from "@robots/core";
import { desktopBridge } from "./desktop";
import { mcpOAuthRedirectUri } from "./mcp-connect";
import type { RpcClient } from "./rpc";
import { createSpaceRpc, rpc } from "./rpc";

const pendingKey = "robots:remote-app-signin";

type Pending = {
  state: string;
  serverId: string;
  spaceId: string | null;
  botId?: string;
};

async function assignBot(client: RpcClient, serverId: string, botId?: string) {
  if (botId) await client.mcp.assignments.approve({ botId, serverId });
}

async function nativeAuthorization(
  browser: RobotsDesktop["oauth"],
  url: string,
  state: string,
  signal: AbortSignal,
) {
  const deadline = deadlineSignal(10 * 60_000, signal);
  let unsubscribe: (() => void) | undefined;
  const callback = new Promise<string>((resolve) => {
    unsubscribe = browser.onCallback((result) => {
      if (result.state === state) resolve(result.code);
    });
  });
  try {
    await browser.open!(url);
    return await withAbort(callback, deadline);
  } finally {
    unsubscribe?.();
    await browser.cancel?.(url);
  }
}

export async function signInToRemoteApp(
  client: RpcClient,
  server: Pick<McpServer, "id">,
  spaceId: string | null,
  signal: AbortSignal,
  botId?: string,
) {
  const desktop = desktopBridge();
  if (desktop && !desktop.oauth?.open) throw new Error("Update RoBots to open browser sign-in.");
  const started = await client.mcp.oauth.begin({
    serverId: server.id,
    redirectUri: desktop ? REMOTE_APP_NATIVE_CALLBACK : mcpOAuthRedirectUri(),
  });
  if (signal.aborted) return;
  if (started.status !== "authorization_required") {
    if (started.status === "already_connected") return assignBot(client, server.id, botId);
    throw new Error("This app did not request sign-in. Try connecting again.");
  }
  if (desktop) {
    const code = await nativeAuthorization(
      desktop.oauth,
      started.authorizationUrl,
      started.sessionId,
      signal,
    ).catch((error: unknown) => {
      if (!signal.aborted) throw error;
    });
    if (!code || signal.aborted) return;
    await client.mcp.oauth.complete({
      code,
      state: started.sessionId,
      sessionId: started.sessionId,
    });
    return assignBot(client, server.id, botId);
  }
  const pending: Pending = { state: started.sessionId, serverId: server.id, spaceId, botId };
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  window.location.assign(started.authorizationUrl);
}

export async function completeBrowserMcpAuthorization(code: string, state: string) {
  const raw = sessionStorage.getItem(pendingKey);
  const pending = raw ? (JSON.parse(raw) as Pending) : undefined;
  if (pending?.state !== state) return rpc.mcp.oauth.complete({ code, state, sessionId: state });
  sessionStorage.removeItem(pendingKey);
  const client = createSpaceRpc(pending.spaceId);
  await client.mcp.oauth.complete({ code, state, sessionId: state });
  await assignBot(client, pending.serverId, pending.botId);
}
