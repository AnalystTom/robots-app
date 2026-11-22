import { Trans, useLingui } from "@lingui/react/macro";
import type { McpServer } from "@robots/contracts";
import { mcpServerConnection } from "@robots/contracts";
import type { RemoteMcpApp } from "@robots/core";
import { customMcpServerInput, remoteMcpAppServer } from "@robots/core";
import { Button, toast } from "@robots/ui-web";
import { useCallback, useRef } from "react";
import {
  ConnectionPage,
  ConnectionRow,
  ConnectionSection,
} from "../../components/integrations/connection-page";
import { PluginLogo } from "../../components/integrations/plugin-marketplace";
import { useSave, useSpaceQueries } from "../../lib/query";
import { signInToRemoteApp } from "../../lib/remote-app-signin";
import { selectedSpaceId } from "../../lib/rpc";
import { useBoundSpaceId } from "../../lib/space-rpc";
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
  const attempt = useRef<AbortController | null>(null);
  const cancelOnClose = useCallback((node: HTMLDivElement | null) => {
    if (!node) attempt.current?.abort();
  }, []);
  const boundSpaceId = useBoundSpaceId();
  const server = remoteMcpAppServer(app, servers);
  const connected = server ? mcpServerConnection(server) === "connected" : false;
  const connect = useSave({
    save: async (signal: AbortSignal, rpc) => {
      const spaceId = boundSpaceId === undefined ? selectedSpaceId() : boundSpaceId;
      const listed = remoteMcpAppServer(app, await rpc.mcp.servers.list());
      const target =
        listed ?? (await rpc.mcp.servers.create(customMcpServerInput(app.name, app.endpoint)));
      await signInToRemoteApp(rpc, target, spaceId, signal, botId);
    },
    stale: [queries.mcp.servers.list.queryKey()],
    onFailed: (error) => toast.error(errorText(error, t`Could not connect ${app.name}`)),
  });

  return (
    <div ref={cancelOnClose} data-testid="connection-detail">
      <ConnectionPage
        name={app.name}
        icon={<PluginLogo name={app.name} site={app.site} size="large" />}
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
                  onClick={() => {
                    if (connect.pending) return attempt.current?.abort();
                    attempt.current = new AbortController();
                    connect.run(attempt.current.signal);
                  }}
                >
                  {connect.pending ? <Trans>Cancel</Trans> : <Trans>Connect</Trans>}
                </Button>
              )
            }
          />
        </ConnectionSection>
      </ConnectionPage>
    </div>
  );
}
