import { Trans, useLingui } from "@lingui/react/macro";
import type { PermissionTool, RiskyCapability, ToolPermission } from "@robots/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@robots/ui-web";
import type { ReactNode } from "react";
import { ConnectionIcon } from "./connection-icon";
import type { ToolPermissions } from "./use-tool-permissions";

export type PermissionGrant = {
  id: string;
  label: string;
  detail: string;
  pending: boolean;
  onAllow?: () => void;
};

export function usePermissionCopy(bot: string) {
  const { t } = useLingui();
  const noun: Record<RiskyCapability, string> = {
    email: t`email`,
    message: t`message`,
    delete: t`deletion`,
    post: t`post`,
    pay: t`payment`,
  };
  const action: Record<RiskyCapability, string> = {
    email: t`send email`,
    message: t`send messages`,
    delete: t`delete things`,
    post: t`post for you`,
    pay: t`make payments`,
  };
  const explanation: Record<RiskyCapability, string> = {
    email: t`${bot} writes each email and sends it only after you approve it.`,
    message: t`${bot} writes each message and sends it only after you approve it.`,
    delete: t`${bot} shows what it will delete and waits for your approval.`,
    post: t`${bot} drafts each post and publishes it only after you approve it.`,
    pay: t`${bot} shows each payment and pays only after you approve it.`,
  };
  return {
    noun,
    title: (capability: RiskyCapability) => t`Allow ${bot} to ${action[capability]}`,
    explanation,
    asksBefore: (things: string) => t`${bot} asks before each ${things}`,
    allowedWithoutAsking: t`${bot} goes ahead without asking`,
    reviewedFirst: t`A model checks each one and asks you when unsure`,
  };
}

function DialogRow({
  label,
  detail,
  control,
}: {
  label: ReactNode;
  detail: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body text-foreground">{label}</div>
        <div className="text-body-sm text-muted-foreground">{detail}</div>
      </div>
      {control}
    </div>
  );
}

export function PermissionDialog({
  appName,
  appLogo,
  appIcon,
  botName,
  tool,
  capability,
  turnOn,
  permissions,
  grants,
  onClose,
}: {
  appName: string;
  appLogo?: string | null;
  appIcon?: ReactNode;
  botName: string;
  tool: PermissionTool;
  capability: RiskyCapability;
  turnOn: ToolPermission;
  permissions: ToolPermissions;
  grants: PermissionGrant[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const copy = usePermissionCopy(botName);
  const state = permissions.stateOf(tool);
  const on = state !== null && state !== "deny";
  const detail =
    state === "allow"
      ? copy.allowedWithoutAsking
      : state === "review"
        ? copy.reviewedFirst
        : copy.asksBefore(copy.noun[capability]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="permission-dialog" className="gap-5 sm:max-w-md">
        <DialogHeader className="gap-3">
          <ConnectionIcon name={appName} logo={appLogo} icon={appIcon} />
          <DialogTitle className="text-heading3">{copy.title(capability)}</DialogTitle>
          <DialogDescription>{copy.explanation[capability]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <DialogRow
            label={tool.label}
            detail={detail}
            control={
              <Switch
                aria-label={t`Allow ${tool.label}`}
                checked={on}
                disabled={!permissions.editable(tool) || permissions.pending}
                onCheckedChange={(checked) =>
                  permissions.set([tool], checked ? (turnOn === "deny" ? "ask" : turnOn) : "deny")
                }
              />
            }
          />
          {grants.map((grant) => (
            <DialogRow
              key={grant.id}
              label={grant.label}
              detail={grant.detail}
              control={
                grant.onAllow ? (
                  <Button
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
        </div>
        {permissions.error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {permissions.error}
          </p>
        ) : null}
        <div className="space-y-1 text-body-sm text-muted-foreground">
          <p>
            <Trans>When this is off, {botName} can't do it even if you ask.</Trans>
          </p>
          <p>
            <Trans>This also shows in Settings › Approvals.</Trans>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
