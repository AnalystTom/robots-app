import { t } from "@lingui/core/macro";
import type { NativeStackNavigationOptions } from "expo-router";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { iosAtLeast } from "../lib/native-controls";
import { NativeSymbol } from "./native-symbol";

export function openInvite() {
  router.push("/invite");
}

/**
 * A chat header's right side: the group's settings button in a group, the invite gift in a bot
 * chat when the account can invite. The bot's own actions live in its profile, which the title
 * opens. The chat route declares it when the screen is created, so the title is centred against
 * it from the first frame; both use this one builder so the item never changes shape.
 */
export function threadHeaderRight({
  inGroup,
  readOnly,
  color,
  onGroupSettings,
  onInvite,
  onNewChat,
}: {
  inGroup: boolean;
  readOnly: boolean;
  color: string;
  onGroupSettings: () => void;
  /** Opens the invite sheet; absent when the account cannot invite. */
  onInvite?: () => void;
  /** Starts a new chat; absent in a group or an archived chat. */
  onNewChat?: () => void;
}): NativeStackNavigationOptions {
  const settingsLabel = inGroup ? t`Group settings` : t`Invite a friend`;
  const settingsPress = inGroup ? onGroupSettings : onInvite;
  const newChatPress = inGroup ? undefined : onNewChat;
  const items = [
    ...(newChatPress
      ? [
          {
            label: t`New bot`,
            sf: "square.and.pencil" as const,
            android: "create-outline" as const,
            onPress: newChatPress,
          },
        ]
      : []),
    ...(settingsPress
      ? [
          {
            label: settingsLabel,
            sf: inGroup ? ("gearshape" as const) : ("gift" as const),
            android: inGroup ? ("settings-outline" as const) : ("gift-outline" as const),
            onPress: settingsPress,
          },
        ]
      : []),
  ];
  if (readOnly || !items.length) {
    return { headerRight: undefined, unstable_headerRightItems: undefined };
  }
  return {
    ...(iosAtLeast(26)
      ? {
          unstable_headerRightItems: () =>
            items.map((item) => ({
              type: "button" as const,
              label: item.label,
              accessibilityLabel: item.label,
              icon: { type: "sfSymbol" as const, name: item.sf },
              onPress: item.onPress,
            })),
        }
      : { unstable_headerRightItems: undefined }),
    headerRight: () => (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        {items.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            hitSlop={8}
            onPress={item.onPress}
          >
            <NativeSymbol ios={item.sf} android={item.android} size={21} color={color} />
          </Pressable>
        ))}
      </View>
    ),
  };
}
