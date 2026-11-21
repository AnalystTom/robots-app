import { Trans, useLingui } from "@lingui/react/macro";
import type { McpServer } from "@robots/contracts";
import { mcpServerConnection } from "@robots/contracts";
import type { PermissionTool } from "@robots/core";
import { humanizeToolName, mcpPermissionToolName, SERVER_CONNECTION_PLACEMENT } from "@robots/core";
import { Button } from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  ConnectionPage,
  ConnectionRow,
  ConnectionSection,
  ToolsSection,
} from "../components/integrations/connection-page";
import type { PermissionGrant } from "../components/integrations/permission-dialog";
import { McpServerHealthLine } from "../components/McpServerHealthLine";
import { useSpaceQueries } from "../lib/query";
import { ConnectionStatus } from "./plugins/parts";

export type McpServerSignIn = {
  label: string;
  pending: boolean;
  signedIn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function McpServerPage({
  server,
  botName,
  signIn,
  access,
  testing,
  onEdit,
  onTest,
  onDelete,
}: {
  server: McpServer;
  botName: string;
  signIn: McpServerSignIn | null;
  access: ReactNode;
  testing: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const connection = mcpServerConnection(server);
  const connected = connection === "connected";
  const toolsQuery = useQuery({
    ...queries.mcp.servers.tools.queryOptions({ input: { id: server.id } }),
    enabled: connected,
  });
  const tools: PermissionTool[] = (toolsQuery.data ?? []).map((tool) => ({
    name: mcpPermissionToolName(server.slug, tool.name),
    label: humanizeToolName(tool.name),
    readOnly: tool.readOnly,
  }));
  const grants: PermissionGrant[] =
    signIn && connection === "needs_sign_in"
      ? [
          {
            id: "sign-in",
            label: t`Sign in to ${server.name}`,
            detail: t`Lets ${botName} use this server`,
            pending: signIn.pending,
            onAllow: signIn.onConnect,
          },
        ]
      : [];

  return (
    <div data-testid="mcp-server-page">
      <ConnectionPage
        name={server.name}
        placement={SERVER_CONNECTION_PLACEMENT}
        description={server.description || server.endpoint || server.command || server.slug}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              <Trans>Edit</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={testing || server.health.status === "installing"}
              onClick={onTest}
            >
              <Trans>Test connection</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trans>Delete</Trans>
            </Button>
          </>
        }
      >
        <ConnectionSection data-testid="connection-accounts" title={<Trans>Access</Trans>}>
          <ConnectionRow
            label={server.endpoint ?? server.command ?? server.slug}
            detail={
              testing ||
              server.health.status === "error" ||
              server.health.status === "installing" ? (
                <McpServerHealthLine health={server.health} checking={testing} />
              ) : (
                <ConnectionStatus server={server} />
              )
            }
            action={
              <>
                {access}
                {signIn && (signIn.signedIn || !connected) ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={signIn.pending}
                    onClick={signIn.signedIn ? signIn.onDisconnect : signIn.onConnect}
                  >
                    {signIn.signedIn ? <Trans>Disconnect</Trans> : signIn.label}
                  </Button>
                ) : null}
              </>
            }
          />
        </ConnectionSection>
        <ToolsSection
          appName={server.name}
          appSlug={server.slug}
          tools={tools}
          loading={connected && toolsQuery.isPending}
          botName={botName}
          grantsFor={() => grants}
        />
      </ConnectionPage>
    </div>
  );
}
