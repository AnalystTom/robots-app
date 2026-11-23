import { useLingui } from "@lingui/react/macro";
import { APP_LOCALE_LABELS } from "@robots/core";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeSegmentedControl } from "../../components/native-segmented-control";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSwitch,
  useStackedSettings,
} from "../../components/settings-group";
import { currentApiBase, rpc, selectedSpaceId } from "../../lib/api";
import { getCachedAppearancePreference, setAppearancePreference } from "../../lib/appearance";
import {
  getHapticsEnabled,
  loadHapticsPreference,
  setHapticsEnabled,
  subscribeHaptics,
} from "../../lib/haptics";
import { useUiLocale } from "../../lib/i18n";
import type { LiveNotificationSettings } from "../../lib/live-notifications";
import {
  canPostPromotedNotifications,
  DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  getLiveNotificationSettings,
  hasLiveUpdateSettings,
  openLiveNotificationSettings,
  openPromotedNotificationSettings,
  setLiveNotificationSettings,
} from "../../lib/live-notifications";
import type { MobileMe } from "../../lib/mobile-types";
import { useThemedStyles } from "../../lib/native";
import { registerPushToken } from "../../lib/push";
import { useSave } from "../../lib/query";
import {
  getCachedRemoteImagesEnabled,
  setRemoteImagesPreference,
  subscribeRemoteImages,
} from "../../lib/remote-images-preference";
import {
  getCachedResponseStreamingEnabled,
  setResponseStreamingPreference,
  subscribeResponseStreaming,
} from "../../lib/response-streaming";
import { loadSessionToken } from "../../lib/session";
import { createSettingsPageStyles } from "../../lib/settings-page-styles";
import { ACCOUNT_SETTINGS } from "../../lib/settings-target";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

export default function General() {
  const sideInsets = useSideInsets();
  const { t } = useLingui();
  const locale = useUiLocale();
  const router = useRouter();
  const styles = useThemedStyles(createSettingsPageStyles);
  const stacked = useStackedSettings();
  const [me, setMe] = useState<MobileMe | null>(null);
  const appearance = getCachedAppearancePreference();
  const streamReplies = useSyncExternalStore(
    subscribeResponseStreaming,
    getCachedResponseStreamingEnabled,
    () => false,
  );
  const loadRemoteImages = useSyncExternalStore(
    subscribeRemoteImages,
    getCachedRemoteImagesEnabled,
    () => false,
  );
  const hapticsEnabled = useSyncExternalStore(
    subscribeHaptics,
    getHapticsEnabled,
    getHapticsEnabled,
  );
  const [notifications, setNotifications] = useState<LiveNotificationSettings>(
    DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  );
  const [notificationsReady, setNotificationsReady] = useState(Platform.OS !== "android");
  const [notificationPermission, setNotificationPermission] = useState<string | null>(null);

  const haptics = useSave({
    save: (value: boolean) => setHapticsEnabled(value),
    onFailed: (_error, value) =>
      Alert.alert(t`Haptics`, t`Could not save`, [
        { text: t`Cancel`, style: "cancel" },
        { text: t`Retry`, onPress: () => haptics.run(value) },
      ]),
  });

  const liveNotifications = useSave({
    save: async (settings: LiveNotificationSettings) => {
      await setLiveNotificationSettings(
        settings,
        currentApiBase(),
        await loadSessionToken(),
        selectedSpaceId() ?? "",
      );
      if (settings.liveConnection && !(await canPostPromotedNotifications())) {
        await openPromotedNotificationSettings();
      }
      await registerPushToken();
    },
    onSaved: (_saved, settings) => setNotifications(settings),
  });
  const shownNotifications =
    liveNotifications.pending && liveNotifications.input ? liveNotifications.input : notifications;
  const liveNotificationsDisabled = !notificationsReady || liveNotifications.pending;

  const botStyle = useSave({
    save: (botAvatarSet: MobileMe["botAvatarSet"], send) =>
      send("preferences/update", { botAvatarSet }),
    onSaved: (next) =>
      setMe((current) => (current ? { ...current, botAvatarSet: next.botAvatarSet } : next)),
    onFailed: () => Alert.alert(t`Couldn't update bot style`),
  });

  const pushSetting = useSave({
    target: ACCOUNT_SETTINGS,
    save: (pushNotifications: boolean, send) => send("preferences/update", { pushNotifications }),
    onSaved: (next) =>
      setMe((current) =>
        current ? { ...current, pushNotifications: next.pushNotifications } : next,
      ),
    onFailed: () => Alert.alert(t`Push notifications`, t`Could not save`),
  });

  // Read on every visit, so a failed read retries when the page is shown again.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void rpc("me")
        .then((next) => {
          if (active) setMe(next);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
    if (Platform.OS === "android") {
      void getLiveNotificationSettings()
        .then(setNotifications)
        .catch(() => undefined)
        .finally(() => setNotificationsReady(true));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHapticsPreference();
    }, []),
  );

  // Granting notifications in system settings leaves this screen mounted, so the
  // row would keep saying blocked until the app comes back to the foreground.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      let active = true;
      const read = () => {
        void Notifications.getPermissionsAsync()
          .then((permission) => {
            if (active) setNotificationPermission(permission.status);
          })
          .catch(() => undefined);
      };
      read();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") read();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, []),
  );

  function chooseBotStyle(botAvatarSet: MobileMe["botAvatarSet"] | "") {
    if (botAvatarSet) botStyle.run(botAvatarSet);
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={[styles.content, stacked && styles.compactContent]}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View accessibilityLabel={t`Appearance`} style={styles.section}>
          <SettingsLabel>{t`Appearance`}</SettingsLabel>
          <NativeSegmentedControl
            accessibilityLabel={t`Appearance`}
            onChange={(value) => void setAppearancePreference(value)}
            options={[
              { value: "system", label: t`System` },
              { value: "light", label: t`Light` },
              { value: "dark", label: t`Dark` },
            ]}
            value={appearance}
          />
        </View>

        {me ? (
          <View accessibilityLabel={t`Bot style`} style={styles.section}>
            <SettingsLabel>{t`Bot style`}</SettingsLabel>
            <NativeSegmentedControl
              accessibilityLabel={t`Bot style`}
              onChange={chooseBotStyle}
              options={[
                { value: "organic", label: t`Original` },
                { value: "robots", label: t`RoBots` },
              ]}
              value={botStyle.pending && botStyle.input ? botStyle.input : (me.botAvatarSet ?? "")}
            />
          </View>
        ) : null}

        <SettingsGroup>
          <SettingsRow
            accessibilityRole="button"
            accessibilityLabel={t`Language`}
            accessibilityValue={{ text: APP_LOCALE_LABELS[locale] }}
            chevron="right"
            onPress={() => router.push("/language")}
            title={t`Language`}
            value={APP_LOCALE_LABELS[locale]}
          />
          <SettingsSwitch
            label={t`Haptics`}
            value={hapticsEnabled}
            disabled={haptics.pending}
            onChange={(value) => haptics.run(value)}
          />
          {me ? (
            <SettingsSwitch
              label={t`Push notifications`}
              value={pushSetting.pending ? Boolean(pushSetting.input) : me.pushNotifications}
              disabled={pushSetting.pending}
              onChange={(checked) => pushSetting.run(checked)}
            />
          ) : null}
        </SettingsGroup>

        {Platform.OS === "android" ? (
          <SettingsGroup accessibilityLabel={t`Notifications`} label={t`Notifications`}>
            {notificationPermission === "denied" ? (
              <SettingsRow
                accessibilityRole="button"
                detail={t`Android blocked notifications.`}
                onPress={() => void openLiveNotificationSettings()}
                title={t`Notifications`}
              />
            ) : null}
            <SettingsSwitch
              label={t`Live working status`}
              value={shownNotifications.liveConnection}
              disabled={liveNotificationsDisabled}
              onChange={(liveConnection) =>
                liveNotifications.run({ ...notifications, liveConnection })
              }
            />
            <SettingsSwitch
              label={t`Agent messages`}
              detail={t`Replies and completed work`}
              value={shownNotifications.messages}
              disabled={liveNotificationsDisabled}
              onChange={(messages) => liveNotifications.run({ ...notifications, messages })}
            />
            <SettingsSwitch
              label={t`Scheduled tasks`}
              value={shownNotifications.scheduledTasks}
              disabled={liveNotificationsDisabled}
              onChange={(scheduledTasks) =>
                liveNotifications.run({ ...notifications, scheduledTasks })
              }
            />
            <SettingsSwitch
              label={t`Needs attention`}
              detail={t`Questions, approvals, takeover`}
              value={shownNotifications.needsAttention}
              disabled={liveNotificationsDisabled}
              onChange={(needsAttention) =>
                liveNotifications.run({ ...notifications, needsAttention })
              }
            />
            {hasLiveUpdateSettings() ? (
              <SettingsRow
                accessibilityRole="button"
                onPress={() => void openPromotedNotificationSettings()}
                title={t`Live update settings`}
              />
            ) : null}
            <SettingsRow
              accessibilityRole="button"
              onPress={() => void openLiveNotificationSettings()}
              title={t`Notification settings`}
            />
            {liveNotifications.error ? (
              <Text style={styles.error}>
                {errorText(liveNotifications.error, t`Could not update notifications`)}
              </Text>
            ) : null}
          </SettingsGroup>
        ) : null}

        <SettingsGroup>
          <SettingsSwitch
            label={t`Stream replies`}
            value={streamReplies}
            onChange={(checked) => void setResponseStreamingPreference(checked ? "on" : "off")}
          />
          <SettingsSwitch
            label={t`Load web images automatically`}
            value={loadRemoteImages}
            onChange={(checked) => void setRemoteImagesPreference(checked ? "on" : "off")}
          />
          <SettingsRow
            accessibilityRole="button"
            chevron="right"
            onPress={() => router.push("/ai-data-sharing")}
            title={t`AI data sharing`}
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
