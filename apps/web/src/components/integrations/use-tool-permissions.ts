import { useLingui } from "@lingui/react/macro";
import type { PermissionTool, ToolPermission, ToolPermissionPolicy } from "@robots/core";
import {
  appTurnedOff,
  ToolPermissionLimitError,
  toolPermissionEditable,
  toolPermissionState,
  withAppTurnedOff,
  withToolPermissions,
} from "@robots/core";
import { useQuery } from "@tanstack/react-query";
import { useSave, useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";

type PermissionChange =
  | { tools: readonly PermissionTool[]; permission: ToolPermission }
  | { connectorKind: string; off: boolean };

export type ToolPermissions = ReturnType<typeof useToolPermissions>;

export function useToolPermissions() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const actionRules = useQuery(queries.actionRules.list.queryOptions({ input: {} }));
  const approvalRules = useQuery(queries.approvalRules.list.queryOptions({ input: {} }));
  const autoReview = useQuery(queries.autoReview.get.queryOptions({ input: {} }));
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
    save: async (change: PermissionChange, client) => {
      if (!policy) return;
      const rules =
        "tools" in change
          ? withToolPermissions(policy, change.tools, change.permission)
          : withAppTurnedOff(policy, change.connectorKind, change.off);
      await client.actionRules.set({ rules });
    },
    stale: [queries.actionRules.list.key()],
  });
  const loadError = actionRules.error ?? approvalRules.error ?? autoReview.error;
  const failure = save.error ?? loadError;

  function stateOf(tool: PermissionTool) {
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
    ready: policy !== null,
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
