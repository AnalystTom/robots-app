import { useLingui } from "@lingui/react/macro";
import type { PermissionTool, RiskyCapability } from "@robots/core";
import { Modal, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemedStyles } from "../lib/native";
import type { ToolPermissions } from "../lib/tool-permissions";
import { usePermissionCopy } from "../lib/tool-permissions";
import { ConnectorIcon } from "./connector-icon";
import { createIntegrationsStyles } from "./integrations-styles";
import { NativeActionButton } from "./native-action-button";
import { NativeSwitch } from "./native-switch";

const SHEET_ICON_SIZE = 48;

export type PermissionSheetGrant = { id: string; label: string; detail: string };

export function PermissionSheet({
  appName,
  appLogo,
  botName,
  tool,
  capability,
  grants,
  permissions,
  onClose,
}: {
  appName: string;
  appLogo: string | null;
  botName: string;
  tool: PermissionTool;
  capability: RiskyCapability;
  grants: readonly PermissionSheetGrant[];
  permissions: ToolPermissions;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createIntegrationsStyles);
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const copy = usePermissionCopy(botName);
  const state = permissions.stateOf(tool);
  const detail =
    state === "allow"
      ? copy.allowedWithoutAsking
      : state === "review"
        ? copy.reviewedFirst
        : copy.asksBefore(copy.noun[capability]);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View
        testID="permission-dialog"
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingTop: Platform.OS === "ios" ? 12 : insets.top + 12,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <View style={styles.sheetHeader}>
          <NativeActionButton label={t`Done`} onPress={onClose} prominence="plain" />
        </View>
        <ConnectorIcon logo={appLogo} name={appName} size={SHEET_ICON_SIZE} />
        <Text accessibilityRole="header" style={styles.heroTitle}>
          {copy.title(capability)}
        </Text>
        <Text style={styles.explanation}>{copy.explanation[capability]}</Text>
        <View style={[styles.groupCard, styles.groupRow]}>
          <View style={styles.grow}>
            <Text style={styles.rowLabel}>{tool.label}</Text>
            <Text style={styles.secondary}>{detail}</Text>
          </View>
          <NativeSwitch
            accessibilityLabel={t`Allow ${tool.label}`}
            value={state !== null && state !== "deny"}
            disabled={!permissions.editable(tool) || permissions.pending}
            onValueChange={(on) => permissions.set([tool], on ? "ask" : "deny")}
          />
        </View>
        {grants.map((grant) => (
          <View key={grant.id} style={[styles.groupCard, styles.groupRow]}>
            <View style={styles.grow}>
              <Text style={styles.rowLabel}>{grant.label}</Text>
              <Text style={styles.secondary}>{grant.detail}</Text>
            </View>
          </View>
        ))}
        {permissions.error ? <Text style={styles.error}>{permissions.error}</Text> : null}
        <Text style={styles.caption}>{copy.offBlocks}</Text>
        <Text style={styles.caption}>{copy.inSettings}</Text>
      </View>
    </Modal>
  );
}
