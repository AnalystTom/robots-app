import { useLingui } from "@lingui/react/macro";
import type { SpaceBot } from "@robots/contracts";
import { typeScale } from "@robots/ui-tokens";
import { Pressable, Text, View } from "react-native";
import type { MobileBot } from "../../lib/mobile-types";
import { useMobileTokens } from "../../lib/native";
import { BotAvatar } from "../bot-avatar";

export function ThreadEmptyState({
  bot,
  bottomInset,
  onPick,
}: {
  bot: MobileBot | SpaceBot;
  bottomInset: number;
  onPick: (prompt: string) => void;
}) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const prompts = [t`What can you do?`, t`Plan my week`, t`Help me write an email`];
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: bottomInset,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        paddingHorizontal: 24,
      }}
    >
      <BotAvatar color={bot.color} avatarSet={bot.avatarSet} identity={bot.id} size={72} />
      <View style={{ alignItems: "center", gap: 8, marginTop: 12 }}>
        {prompts.map((prompt) => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            onPress={() => onPick(prompt)}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: tokens.border,
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: tokens.foreground, ...typeScale.body }}>{prompt}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
