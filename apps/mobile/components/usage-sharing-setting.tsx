import { useLingui } from "@lingui/react/macro";
import { Alert } from "react-native";
import { useUsageSharing } from "../lib/usage-sharing";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsSwitch } from "./settings-group";

export function UsageSharingSetting() {
  const { t } = useLingui();
  const { available, enabled, save } = useUsageSharing({
    onFailed: (error) =>
      Alert.alert(t`Share usage data`, errorText(error, t`Could not save your choice`)),
  });
  if (!available) return null;
  return (
    <SettingsGroup>
      <SettingsSwitch
        label={t`Share usage data`}
        detail={t`Help improve RoBots with how you use it, never your messages or files. Crash reports are sent either way.`}
        value={enabled}
        disabled={save.pending}
        onChange={save.run}
      />
    </SettingsGroup>
  );
}
