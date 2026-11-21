import { Trans, useLingui } from "@lingui/react/macro";
import type { Connection, ConnectionCatalogItem } from "@robots/contracts";
import { CONNECTION_LABEL_MAX_LENGTH } from "@robots/contracts";
import type { PermissionTool } from "@robots/core";
import {
  appToolLabel,
  catalogItemAccounts,
  catalogItemKey,
  groupToolsByEffect,
  SERVER_CONNECTION_PLACEMENT,
} from "@robots/core";
import { Button, Input } from "@robots/ui-web";
import { Plus } from "lucide-react";
import {
  ConnectionPage,
  ConnectionRow,
  ConnectionSection,
  ToolsSection,
} from "../../components/integrations/connection-page";
import type { PluginConnections } from "./use-plugin-connections";

export function ConnectorDetail({
  item,
  state,
  botName,
  description,
}: {
  item: ConnectionCatalogItem;
  state: PluginConnections;
  botName: string;
  description?: string;
}) {
  const { t } = useLingui();
  const { pending, tools, toolsLoading, connect, uninstall } = state;
  const accounts = catalogItemAccounts(state.connections, item);
  const key = catalogItemKey(item);
  const connecting = pending === key;
  const uninstalling = pending === `uninstall:${key}`;
  const permissionTools: PermissionTool[] = tools.map((tool) => ({
    name: tool.name,
    label: appToolLabel(tool.name, item.slug),
    readOnly: tool.readOnly,
  }));
  const { actions } = groupToolsByEffect(permissionTools);
  const summary =
    description ||
    (accounts.length === 0
      ? t`Connect an account so ${botName} can use ${item.name}.`
      : permissionTools.length === 0
        ? null
        : actions.length > 0
          ? t`Look things up and take actions in ${item.name}.`
          : t`Look things up in ${item.name}.`);

  return (
    <div data-testid="connection-detail">
      <ConnectionPage
        name={item.name}
        logo={item.logo}
        placement={SERVER_CONNECTION_PLACEMENT}
        description={summary}
        footer={
          accounts.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={uninstalling || connecting}
              onClick={() => void uninstall(item)}
            >
              {uninstalling ? <Trans>Removing…</Trans> : <Trans>Uninstall</Trans>}
            </Button>
          ) : null
        }
      >
        <ConnectionSection data-testid="connection-accounts" title={<Trans>Access</Trans>}>
          {accounts.length === 0 ? (
            <ConnectionRow
              label={t`${item.name} account`}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={connecting}
                  onClick={() => void connect(item)}
                >
                  {connecting ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
                </Button>
              }
            />
          ) : (
            <>
              {accounts.map((row) => (
                <AccountRow
                  key={row.id}
                  row={row}
                  item={item}
                  state={state}
                  disabled={pending === row.id || uninstalling}
                />
              ))}
              <ConnectionRow
                label={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ms-2 text-body text-muted-foreground"
                    disabled={connecting || uninstalling}
                    onClick={() => void connect(item)}
                  >
                    <Plus />
                    {connecting ? <Trans>Adding…</Trans> : <Trans>Add another</Trans>}
                  </Button>
                }
              />
            </>
          )}
        </ConnectionSection>

        {accounts.length > 0 ? (
          <ToolsSection
            appName={item.name}
            appSlug={item.slug}
            appLogo={item.logo}
            tools={permissionTools}
            loading={toolsLoading}
            botName={botName}
          />
        ) : null}
      </ConnectionPage>
    </div>
  );
}

function AccountRow({
  row,
  item,
  state,
  disabled,
}: {
  row: Connection;
  item: ConnectionCatalogItem;
  state: PluginConnections;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const { labelDrafts, setLabelDrafts, renameAccount, revokeAccount, pending } = state;
  return (
    <ConnectionRow
      label={
        <Input
          value={labelDrafts[row.id] ?? row.displayName}
          aria-label={t`Account label`}
          maxLength={CONNECTION_LABEL_MAX_LENGTH}
          className="-ms-2 h-8 rounded-lg border-transparent bg-transparent px-2 text-body shadow-none hover:bg-accent/60 focus-visible:bg-background dark:bg-transparent"
          onChange={(event) =>
            setLabelDrafts((current) => ({ ...current, [row.id]: event.target.value }))
          }
          onBlur={() => void renameAccount(row)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              if (event.key === "Escape") event.stopPropagation();
              return;
            }
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      }
      detail={
        row.status === "connected" ? <Trans>Connected</Trans> : <Trans>Waiting for sign-in</Trans>
      }
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={disabled}
          onClick={() => void revokeAccount(row, item)}
        >
          {pending === row.id ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
        </Button>
      }
    />
  );
}
