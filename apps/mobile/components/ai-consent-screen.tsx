import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Linking, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  aiDataDisclosure,
  approveAiConsent,
  denyAiConsent,
  reviewAiConsentAgain,
  useAiConsentRequest,
} from "../lib/ai-consent";
import { native, useMobileTokens, useThemedStyles } from "../lib/native";
import { AppMark } from "./app-mark";
import { NativeActionButton } from "./native-action-button";

export function AiConsentScreen() {
  const request = useAiConsentRequest();
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  if (!request) return null;
  const names = [...new Set(request.recipients.map((recipient) => recipient.name))].join(", ");
  const uses = [...new Set(request.recipients.map((recipient) => recipient.use))];
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={denyAiConsent}
    >
      <View
        testID="ai-consent-screen"
        style={[styles.page, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.body}>
          <AppMark />
          {request.denied ? (
            <>
              <Text accessibilityRole="header" style={[styles.title, { color: tokens.foreground }]}>
                {t`RoBots needs this to work`}
              </Text>
              <Text style={[styles.text, { color: tokens.mutedForeground }]}>
                {t`Your bots can't reply until you allow sharing with ${ph({ name: names })}.`}
              </Text>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={[styles.title, { color: tokens.foreground }]}>
                {t`Share data with ${ph({ name: names })}?`}
              </Text>
              {uses.map((use) => (
                <Text key={use} style={[styles.text, { color: tokens.foreground }]}>
                  {aiDataDisclosure(use)}
                </Text>
              ))}
              <Text style={[styles.text, { color: tokens.mutedForeground }]}>
                {t`You can turn this off in Account → AI data sharing.`}
              </Text>
            </>
          )}
        </View>
        <View style={styles.actions}>
          {request.denied ? (
            <NativeActionButton label={t`Review again`} fill onPress={reviewAiConsentAgain} />
          ) : (
            <>
              <NativeActionButton label={t`Approve`} fill onPress={approveAiConsent} />
              <NativeActionButton
                label={t`Deny`}
                prominence="secondary"
                fill
                onPress={denyAiConsent}
              />
            </>
          )}
          <NativeActionButton
            label={t`Privacy policy`}
            variant="text"
            prominence="plain"
            fill
            onPress={() => void Linking.openURL(request.privacyUrl)}
          />
        </View>
      </View>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
    page: {
      flex: 1,
      paddingHorizontal: 24,
      justifyContent: "space-between",
      backgroundColor: native.page,
    },
    body: { gap: 16, maxWidth: 520, width: "100%", alignSelf: "center" },
    title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginTop: 8 },
    text: { fontSize: 16, lineHeight: 22, textAlign: "center" },
    actions: { gap: 10, maxWidth: 520, width: "100%", alignSelf: "center" },
  });
}
