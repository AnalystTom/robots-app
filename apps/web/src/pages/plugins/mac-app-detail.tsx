import { Trans, useLingui } from "@lingui/react/macro";
import type { MacAppConnection } from "@robots/contracts";
import type { PermissionTool } from "@robots/core";
import { Button, Switch } from "@robots/ui-web";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ConnectionPage,
  ConnectionRow,
  ConnectionSection,
  ToolsSection,
} from "../../components/integrations/connection-page";
import { MacAppIcon } from "../../components/integrations/mac-app-icon";
import { useMacGrants } from "../../components/integrations/use-mac-grants";
import { useToolPermissions } from "../../components/integrations/use-tool-permissions";
import { desktopBridge } from "../../lib/desktop";
import { listUserDevices } from "../../lib/user-devices";

function useThisMac() {
  const device = desktopBridge()?.device;
  const devices = useQuery({ queryKey: ["user-devices"], queryFn: listUserDevices });
  const connect = useMutation({
    mutationFn: async () => device?.setAllowed(true),
    onSettled: () => devices.refetch(),
  });
  const listed = devices.data ?? [];
  return {
    state: devices.isPending
      ? null
      : listed.some((entry) => entry.connected)
        ? ("online" as const)
        : listed.length > 0
          ? ("offline" as const)
          : ("not-connected" as const),
    connect: device ? () => connect.mutate() : null,
    connecting: connect.isPending,
  };
}

export function MacAppDetail({ app, botName }: { app: MacAppConnection; botName: string }) {
  const { t } = useLingui();
  const thisMac = useThisMac();
  const grantRows = useMacGrants();
  const permissions = useToolPermissions();
  const appOff = permissions.appOff(app.connectorKind);
  const tools: PermissionTool[] = app.tools.map((tool) => ({ name: tool.name, label: tool.label }));
  const icon = <MacAppIcon name={app.icon} />;

  return (
    <div data-testid="connection-detail">
      <ConnectionPage
        name={app.name}
        icon={icon}
        placement={app.runsOn}
        description={app.description}
      >
        <ConnectionSection data-testid="connection-accounts" title={<Trans>Access</Trans>}>
          <ConnectionRow
            label={<Trans>This Mac</Trans>}
            detail={
              thisMac.state === "online" ? (
                <Trans>Online</Trans>
              ) : thisMac.state === "offline" ? (
                <Trans>Offline</Trans>
              ) : thisMac.state === "not-connected" && !thisMac.connect ? (
                <Trans>Open RoBots on your Mac to connect</Trans>
              ) : null
            }
            action={
              thisMac.state === "not-connected" && thisMac.connect ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={thisMac.connecting}
                  onClick={thisMac.connect}
                >
                  <Trans>Connect</Trans>
                </Button>
              ) : null
            }
          />
          <ConnectionRow
            label={t`Let ${botName} use ${app.name}`}
            action={
              <Switch
                aria-label={t`Let ${botName} use ${app.name}`}
                checked={appOff === false}
                disabled={appOff === null || permissions.pending}
                onCheckedChange={(on) => permissions.setAppOff(app.connectorKind, !on)}
              />
            }
          />
          {grantRows(app.grants).map((grant) => (
            <ConnectionRow
              key={grant.id}
              data-testid="mac-grant"
              label={grant.label}
              detail={grant.detail}
              action={
                grant.onAllow ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={grant.pending}
                    onClick={grant.onAllow}
                  >
                    <Trans>Allow</Trans>
                  </Button>
                ) : null
              }
            />
          ))}
        </ConnectionSection>
        <ToolsSection
          appName={app.name}
          appSlug={app.connectorKind}
          appIcon={icon}
          tools={tools}
          loading={false}
          botName={botName}
          grantsFor={(tool) =>
            grantRows(app.tools.find((entry) => entry.name === tool.name)?.grants ?? [])
          }
        />
      </ConnectionPage>
    </div>
  );
}
