import { useLingui } from "@lingui/react/macro";
import type { MacGrantId, MacGrantState, MacGrantStatus } from "@robots/contracts";
import { MAC_GRANTS } from "@robots/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopBridge } from "../../lib/desktop";
import type { PermissionGrant } from "./permission-dialog";

const MAC_GRANTS_KEY = ["desktop", "mac-grants"] as const;

export function useMacGrants() {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const bridge = desktop?.macApps;
  const missingBridgeDetail =
    desktop?.platform === "darwin"
      ? t`Update RoBots on this Mac to allow`
      : t`Open RoBots on your Mac to allow`;
  const queryClient = useQueryClient();
  const states = useQuery({
    queryKey: MAC_GRANTS_KEY,
    queryFn: async () => (await bridge?.permissions()) ?? null,
    enabled: Boolean(bridge),
  });
  const allow = useMutation({
    mutationFn: async (grant: MacGrantId) => (await bridge?.allow(grant)) ?? null,
    onSuccess: (next: MacGrantState[] | null) => queryClient.setQueryData(MAC_GRANTS_KEY, next),
  });
  const statusText: Record<MacGrantStatus, string> = {
    granted: t`Allowed`,
    denied: t`Turned off in System Settings`,
    "not-determined": t`Not allowed yet`,
    unavailable: t`Not available on this Mac`,
  };

  return function grantRows(grants: readonly MacGrantId[]): PermissionGrant[] {
    return grants.map((grant) => {
      const status = states.data?.find((entry) => entry.grant === grant)?.status;
      const actionable = bridge && status !== "granted" && status !== "unavailable";
      return {
        id: grant,
        label: MAC_GRANTS[grant].label,
        detail: bridge ? (status ? statusText[status] : t`Checking…`) : missingBridgeDetail,
        pending: allow.isPending && allow.variables === grant,
        onAllow: actionable ? () => allow.mutate(grant) : undefined,
      };
    });
  };
}
