import { Trans, useLingui } from "@lingui/react/macro";
import type { McpServer } from "@robots/contracts";
import { mcpServerConnection } from "@robots/contracts";
import type { RemoteMcpApp } from "@robots/core";
import { customMcpServerInput, remoteMcpAppServer } from "@robots/core";
import { Button, toast } from "@robots/ui-web";
import {
  ConnectionPage,
  ConnectionRow,
  ConnectionSection,
} from "../../components/integrations/connection-page";
import { PluginLogo } from "../../components/integrations/plugin-marketplace";
import { connectMcpOauth } from "../../lib/mcp-connect";
import { useSave, useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";

export function RemoteMcpAppDetail({
  app,
  servers,
  botId,
}: {
  app: RemoteMcpApp;
  servers: readonly McpServer[];
  botId: string | undefined;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const server = remoteMcpAppServer(app, servers);
  const connected = server ? mcpServerConnection(server) === "connected" : false;
  const connect = useSave({
    save: async (_input, rpc) => {
      const listed = remoteMcpAppServer(app, await rpc.mcp.servers.list());
      const target =
        listed ?? (await rpc.mcp.servers.create(customMcpServerInput(app.name, app.endpoint)));
      const result = await connectMcpOauth(target.id);
      if (result !== "cancelled" && botId)
        await rpc.mcp.assignments.approve({ botId, serverId: target.id });
    },
    stale: [queries.mcp.servers.list.queryKey()],
    onFailed: (error) => toast.error(errorText(error, t`Could not connect ${app.name}`)),
  });

  return (
    <div data-testid="connection-detail">
      <ConnectionPage
        name={app.name}
        icon={<PluginLogo name={app.name} site={app.site} large />}
        placement="cloud"
        description={app.description}
      >
        <ConnectionSection data-testid="connection-accounts" title={<Trans>Access</Trans>}>
          <ConnectionRow
            label={t`${app.name} account`}
            detail={connected ? <Trans>Connected</Trans> : null}
            action={
              connected ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={connect.pending}
                  onClick={() => connect.run()}
                >
                  <Trans>Connect</Trans>
                </Button>
              )
            }
          />
        </ConnectionSection>
      </ConnectionPage>
    </div>
  );
}
