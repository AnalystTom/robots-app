import type Ionicons from "@react-native-vector-icons/ionicons";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { native } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

type TemplateSymbol = { ios: string; android: ComponentProps<typeof Ionicons>["name"] };

const BOT_TEMPLATES_SYMBOL: TemplateSymbol = {
  ios: "square.grid.2x2",
  android: "grid-outline",
};

export function BotTemplateIcon({ size = 32 }: { size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        borderCurve: "continuous",
        backgroundColor: native.fillPressed,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <NativeSymbol {...BOT_TEMPLATES_SYMBOL} size={Math.round(size * 0.5)} color={native.label} />
    </View>
  );
}
