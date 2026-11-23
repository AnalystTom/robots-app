import { accountRpcQuery, useSave } from "./query";
import { useScreenQuery } from "./screen-query";
import { ACCOUNT_SETTINGS } from "./settings-target";

export function useUsageSharing(
  options: { onSaved?: () => void; onFailed?: (error: Error) => void } = {},
) {
  const read = accountRpcQuery("me");
  const me = useScreenQuery(read).data;
  const sharing = me?.usageSharing;
  const save = useSave({
    target: ACCOUNT_SETTINGS,
    save: (usageSharing: boolean, send) => send("preferences/update", { usageSharing }),
    stale: [read.queryKey],
    ...options,
  });
  return {
    available: Boolean(sharing?.available),
    enabled: save.pending ? Boolean(save.input) : (sharing?.enabled ?? false),
    save,
  };
}
