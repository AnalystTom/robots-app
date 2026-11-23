import { useLingui } from "@lingui/react/macro";
import { StyleSheet, Text, View } from "react-native";
import { native, useThemedStyles } from "../lib/native";

export function PluginTitle({ name, community }: { name: string; community: boolean }) {
  const styles = useThemedStyles(createStyles);
  const { t } = useLingui();
  return (
    <View style={styles.line}>
      <Text numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      {community ? <Text style={styles.community}>{t`Community`}</Text> : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    line: { flexDirection: "row", alignItems: "baseline", gap: 6, minWidth: 0 },
    name: { flexShrink: 1, color: native.label, fontSize: 15, fontWeight: "500" },
    community: { color: native.secondaryLabel, fontSize: 12 },
  });
}
