import { useLingui } from "@lingui/react/macro";
import { AI_PRIVACY_URL, BOT_COLOR_LIST } from "@robots/contracts";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { LogoAvatar } from "../../components/logo-avatar";
import { NativeActionButton } from "../../components/native-action-button";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
  useStackedSettings,
} from "../../components/settings-group";
import { native, useThemedStyles } from "../../lib/native";
import { closeSettingsSheet } from "../../lib/settings-sheet";
import { useSideInsets } from "../../lib/side-insets";
import { useUsageSharing } from "../../lib/usage-sharing";
import { errorText } from "../../lib/user-error";

const orangeHex = BOT_COLOR_LIST.find((color) => color.id === "orange")?.hex ?? "";

export default function UsageSharingStep() {
  const { t } = useLingui();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const stacked = useStackedSettings();
  const { survey } = useLocalSearchParams<{ survey?: string }>();
  const [shared, setShared] = useState(false);
  const { needed, loaded, loadError, retry, save } = useUsageSharing({
    closesScreen: true,
    onSaved: continueOnboarding,
    onFailed: (error) =>
      Alert.alert(t`Enable data sharing`, errorText(error, t`Could not save your choice`)),
  });

  function continueOnboarding() {
    if (survey) router.replace("/signup-survey");
    else closeSettingsSheet();
  }

  if (loaded && !needed && !save.pending) {
    return <Redirect href={survey ? "/signup-survey" : "/"} />;
  }

  return (
    <ScrollView
      style={[styles.screen, sideInsets]}
      contentContainerStyle={[styles.content, stacked && styles.compactContent]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.header}>
        <LogoAvatar color={orangeHex} size={74} activity="idle" motion="static" />
        <Text style={styles.subtitle}>{t`Help make RoBots better for everyone`}</Text>
      </View>
      <SettingsGroup
        footer={t`Share how you use RoBots, like which screens you open and whether a task finishes. Your messages, files and memory are never included. Crash reports are sent either way. You can change this anytime in Settings.`}
      >
        <SettingsSwitch
          label={t`Share data`}
          value={shared}
          disabled={save.pending}
          onChange={setShared}
        />
      </SettingsGroup>
      {loadError ? (
        <Text style={styles.subtitle}>{errorText(loadError, t`Could not load your choice`)}</Text>
      ) : null}
      {loadError ? (
        <NativeActionButton label={t`Retry`} onPress={retry} />
      ) : (
        <NativeActionButton
          label={t`Continue`}
          busy={save.pending || !loaded}
          onPress={() => save.run(shared)}
        />
      )}
      <SettingsGroup>
        <SettingsRow
          accessibilityRole="link"
          chevron="right"
          onPress={() => void Linking.openURL(AI_PRIVACY_URL)}
          title={t`Privacy Policy`}
        />
      </SettingsGroup>
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 28 },
    compactContent: { paddingHorizontal: 8 },
    header: { alignItems: "center", gap: 12 },
    subtitle: { color: native.secondaryLabel, fontSize: 17, textAlign: "center" },
  });
}
