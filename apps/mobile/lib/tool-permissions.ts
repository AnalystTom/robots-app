import { useLingui } from "@lingui/react/macro";
import type {
  PermissionTool,
  RiskyCapability,
  ToolPermission,
  ToolPermissionPolicy,
  ToolPermissionState,
} from "@robots/core";
import {
  appTurnedOff,
  ToolPermissionLimitError,
  toolPermissionEditable,
  toolPermissionState,
  withAppTurnedOff,
  withToolPermissions,
} from "@robots/core";
import { useQuery } from "@tanstack/react-query";
import { queryClient, rpcQuery, useSave } from "./query";
import { errorText } from "./user-error";

type PermissionChange =
  | { tools: readonly PermissionTool[]; permission: ToolPermission }
  | { connectorKind: string; off: boolean };

export type ToolPermissions = ReturnType<typeof useToolPermissions>;

export function useToolPermissions() {
  const { t } = useLingui();
  const actionRead = rpcQuery("actionRules/list", {});
  const actionRules = useQuery(actionRead, queryClient);
  const approvalRules = useQuery(rpcQuery("approvalRules/list", {}), queryClient);
  const autoReview = useQuery(rpcQuery("autoReview/get", {}), queryClient);
  const policy: ToolPermissionPolicy | null =
    actionRules.data && approvalRules.data && autoReview.data
      ? {
          actionRules: actionRules.data,
          approvalRules: approvalRules.data,
          mode: autoReview.data.mode,
          checkerAvailable: autoReview.data.checkerAvailable,
        }
      : null;
  const save = useSave({
    save: async (change: PermissionChange, send) => {
      if (!policy) return;
      const rules =
        "tools" in change
          ? withToolPermissions(policy, change.tools, change.permission)
          : withAppTurnedOff(policy, change.connectorKind, change.off);
      await send("actionRules/set", { rules });
    },
    stale: [actionRead.queryKey],
  });
  const loadError = actionRules.error ?? approvalRules.error ?? autoReview.error;
  const failure = save.error ?? loadError;

  function stateOf(tool: PermissionTool): ToolPermissionState | null {
    const pending = save.pending ? save.input : undefined;
    if (
      pending &&
      "tools" in pending &&
      pending.tools.some((changed) => changed.name === tool.name)
    )
      return pending.permission;
    return policy ? toolPermissionState(tool, policy) : null;
  }

  return {
    policy,
    stateOf,
    editable: (tool: PermissionTool) => policy !== null && toolPermissionEditable(tool),
    set: (tools: readonly PermissionTool[], permission: ToolPermission) =>
      save.run({ tools, permission }),
    appOff: (connectorKind: string) => {
      const pending = save.pending ? save.input : undefined;
      if (pending && "connectorKind" in pending && pending.connectorKind === connectorKind)
        return pending.off;
      return policy ? appTurnedOff(policy, connectorKind) : null;
    },
    setAppOff: (connectorKind: string, off: boolean) => save.run({ connectorKind, off }),
    pending: save.pending,
    error: failure
      ? failure instanceof ToolPermissionLimitError
        ? t`You have too many approval rules. Remove some in Settings to change this.`
        : errorText(failure, save.error ? t`Could not save` : t`Could not load permissions`)
      : null,
  };
}

export function usePermissionCopy(bot: string) {
  const { t } = useLingui();
  const state: Record<ToolPermissionState | "mixed", string> = {
    allow: t`Allowed`,
    ask: t`Ask each time`,
    deny: t`Off`,
    review: t`Auto review`,
    once: t`Asks once`,
    mixed: t`Mixed`,
  };
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
    state,
    noun,
    explanation,
    title: (capability: RiskyCapability) => t`Allow ${bot} to ${action[capability]}`,
    asksBefore: (things: string) => t`${bot} asks before each ${things}`,
    allowedWithoutAsking: t`${bot} goes ahead without asking`,
    reviewedFirst: t`A model checks each one and asks you when unsure`,
    offBlocks: t`When this is off, ${bot} can't do it even if you ask.`,
    inSettings: t`This also shows in Settings › Approvals.`,
  };
}
