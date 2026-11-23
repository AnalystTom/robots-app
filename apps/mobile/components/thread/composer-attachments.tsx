import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useMobileTokens } from "../../lib/native";
import type { PendingAttachment } from "../../lib/thread-attachments";
import { NativeSymbol } from "../native-symbol";

const THUMBNAIL_SIZE = 64;

export function ComposerAttachments({
  attachments,
  onRemove,
}: {
  attachments: readonly PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  if (!attachments.length) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginTop: 8, marginBottom: 2 }}
      contentContainerStyle={{ gap: 8, paddingTop: 6, paddingEnd: 6 }}
    >
      {attachments.map((attachment) => (
        <View key={attachment.id}>
          {attachment.previewUri ? (
            <Image
              source={{ uri: attachment.previewUri }}
              accessibilityLabel={attachment.name}
              style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: 14 }}
            />
          ) : (
            <View
              style={{
                width: THUMBNAIL_SIZE * 2,
                height: THUMBNAIL_SIZE,
                borderRadius: 14,
                backgroundColor: tokens.muted,
                padding: 10,
                justifyContent: "space-between",
              }}
            >
              <NativeSymbol
                ios="paperclip"
                android="attach"
                size={16}
                color={tokens.mutedForeground}
              />
              <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 13 }}>
                {attachment.name}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t`Remove ${ph({ name: attachment.name })}`}
            hitSlop={8}
            onPress={() => onRemove(attachment.id)}
            style={{
              position: "absolute",
              top: -6,
              end: -6,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: tokens.foreground,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <NativeSymbol ios="xmark" android="close" size={12} color={tokens.background} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
