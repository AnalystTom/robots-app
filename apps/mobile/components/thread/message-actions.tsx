import { useLingui } from "@lingui/react/macro";
import { typeScale } from "@robots/ui-tokens";
import { Pressable, Text, View } from "react-native";
import { dateLocaleForUi, useUiLocale } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";
import { NativeSymbol } from "../native-symbol";

export function MessageActions({ createdAt, onCopy }: { createdAt?: string; onCopy: () => void }) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const locale = useUiLocale();
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString(dateLocaleForUi(locale), {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Copy`}
        hitSlop={10}
        onPress={onCopy}
      >
        <NativeSymbol
          ios="doc.on.doc"
          android="copy-outline"
          size={15}
          color={tokens.faintForeground}
        />
      </Pressable>
      {time ? (
        <Text style={{ color: tokens.faintForeground, ...typeScale.caption }}>{time}</Text>
      ) : null}
    </View>
  );
}
