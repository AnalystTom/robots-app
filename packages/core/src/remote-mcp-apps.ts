export const REMOTE_APP_NATIVE_CALLBACK = "http://127.0.0.1:48191/mcp/oauth/callback";

export type RemoteMcpApp = {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  site: string;
};

export const REMOTE_MCP_APPS: readonly RemoteMcpApp[] = [
  {
    id: "launchpost",
    name: "Launchpost",
    description: "Schedule and publish social posts. Keeps your saved voice.",
    endpoint: "https://launchpost.app/api/mcp/other",
    site: "https://launchpost.app",
  },
];

export function remoteMcpAppServer<S extends { endpoint: string | null }>(
  app: RemoteMcpApp,
  servers: readonly S[],
): S | undefined {
  return servers.find((server) => server.endpoint === app.endpoint);
}

export function matchesRemoteMcpApp(app: RemoteMcpApp, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || `${app.name} ${app.description}`.toLowerCase().includes(needle);
}
