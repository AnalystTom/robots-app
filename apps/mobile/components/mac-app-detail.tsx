import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { MacAppConnection } from "@robots/contracts";
import { MAC_GRANTS } from "@robots/contracts";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { native, useThemedStyles } from "../lib/native";
import { queryClient } from "../lib/query";
import { useToolPermissions } from "../lib/tool-permissions";
import { listUserDevices } from "../lib/user-devices";
import { ConnectorIcon } from "./connector-icon";
import { ToolsSection } from "./integration-detail";
import { createIntegrationsStyles } from "./integrations-styles";
import { NativeSwitch } from "./native-switch";
import { NativeSymbol } from "./native-symbol";

const HERO_ICON_SIZE = 56;

export function MacAppDetail({
  app,
  botName,
  onBack,
}: {
  app: MacAppConnection;
  botName: string;
  onBack: () => void;
}) {
  const styles = useThemedStyles(createIntegrationsStyles);
  const { t } = useLingui();
  const permissions = useToolPermissions();
  const appOff = permissions.appOff(app.connectorKind);
  const devices = useQuery({ queryKey: ["user-devices"], queryFn: listUserDevices }, queryClient);
  const listed = devices.data ?? [];
  const macState = devices.isPending
    ? ""
    : listed.some((device) => device.connected)
      ? t`Online`
      : listed.length > 0
        ? t`Offline`
        : t`Open RoBots on your Mac to connect`;
  const grants = (ids: MacAppConnection["grants"]) =>
    ids.map((id) => ({
      id,
      label: MAC_GRANTS[id].label,
      detail: t`Open RoBots on your Mac to allow`,
    }));

  return (
    <View testID="connection-page" style={styles.detail}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Back`}
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.link}>{t`Back`}</Text>
      </Pressable>
      <View style={styles.hero}>
        <ConnectorIcon name={app.name} size={HERO_ICON_SIZE} />
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.heroTitle}>
            {app.name}
          </Text>
          <View style={styles.placement}>
            <NativeSymbol
              android="laptop"
              color={native.secondaryLabel}
              ios="laptopcomputer"
              size={14}
            />
            <Text style={styles.secondary}>{t`On this Mac`}</Text>
            <Text style={styles.tertiary}>{t`Works while it's online`}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.explanation}>{app.description}</Text>

      <Text style={styles.section}>{t`Access`}</Text>
      <View testID="connection-accounts" style={styles.groupCard}>
        <View style={styles.groupRow}>
          <View style={styles.grow}>
            <Text style={styles.rowLabel}>{t`This Mac`}</Text>
            {macState ? <Text style={styles.secondary}>{macState}</Text> : null}
          </View>
        </View>
        <View style={[styles.groupRow, styles.groupDivider]}>
          <Text style={[styles.rowLabel, styles.grow]}>
            {t`Let ${ph({ bot: botName })} use ${ph({ name: app.name })}`}
          </Text>
          <NativeSwitch
            accessibilityLabel={t`Let ${ph({ bot: botName })} use ${ph({ name: app.name })}`}
            value={appOff === false}
            disabled={appOff === null || permissions.pending}
            onValueChange={(on) => permissions.setAppOff(app.connectorKind, !on)}
          />
        </View>
        {grants(app.grants).map((grant) => (
          <View key={grant.id} style={[styles.groupRow, styles.groupDivider]}>
            <View style={styles.grow}>
              <Text style={styles.rowLabel}>{grant.label}</Text>
              <Text style={styles.secondary}>{grant.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <ToolsSection
        appName={app.name}
        appSlug={app.connectorKind}
        appLogo={null}
        tools={app.tools.map((tool) => ({ name: tool.name, label: tool.label }))}
        loading={false}
        botName={botName}
        grantsFor={(tool) =>
          grants(app.tools.find((entry) => entry.name === tool.name)?.grants ?? [])
        }
      />
    </View>
  );
}
