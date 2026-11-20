import { t } from "@lingui/core/macro";
import { bestEffort } from "@robots/logging";
import {
  buildIdAt,
  CLIENT_BUILD_HEADER,
  formatClientBuild,
  MOBILE_APP_LINKS,
} from "@robots/contracts";
import * as Updates from "expo-updates";
import type { AppStateStatus } from "react-native";
import { Alert, AppState, Linking, Platform } from "react-native";
import { configureClientBuild, currentApiBase } from "./api";

export const FOREGROUND_UPDATE_CHECK_MS = 15 * 60_000;

export function mobileClientBuild(): string | null {
  try {
    if (!Updates.isEnabled) return null;
    const created = Updates.createdAt;
    return created instanceof Date && !Number.isNaN(created.getTime()) ? buildIdAt(created) : null;
  } catch {
    return null;
  }
}

export function clientBuildHeaders(): Record<string, string> {
  const build = mobileClientBuild();
  return build ? { [CLIENT_BUILD_HEADER]: formatClientBuild("mobile", build) } : {};
}

async function downloadUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

function storeListing(): string | undefined {
  return MOBILE_APP_LINKS[Platform.OS === "ios" ? "ios" : "android"];
}

async function downloadAndReload(): Promise<boolean> {
  if (!(await downloadUpdate())) return false;
  await Updates.reloadAsync();
  return true;
}

export async function applyRequiredUpdate(): Promise<void> {
  if (await bestEffort("apply required update", downloadAndReload())) return;
  await bestEffort("open store or web app", Linking.openURL(storeListing() ?? currentApiBase()));
}

let prompting = false;

export function noteClientUpdateRequired(): void {
  if (prompting) return;
  prompting = true;
  const listing = storeListing();
  Alert.alert(
    t`Update required`,
    listing
      ? undefined
      : t`This version of RoBots is no longer supported, and an update is not in the app store yet.`,
    [
      {
        text: listing ? t`Update` : t`Open on the web`,
        onPress: () => {
          void applyRequiredUpdate().finally(() => {
            prompting = false;
          });
        },
      },
    ],
    { cancelable: false },
  );
}

export function installClientUpdates(): void {
  configureClientBuild({ headers: clientBuildHeaders, onUpdateRequired: noteClientUpdateRequired });
}

export function watchForegroundUpdates(now: () => number = Date.now): () => void {
  if (!Updates.isEnabled) return () => {};
  let lastCheck = now();
  let wasBackground = false;
  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "background") wasBackground = true;
    if (state !== "active" || !wasBackground) return;
    wasBackground = false;
    if (now() - lastCheck < FOREGROUND_UPDATE_CHECK_MS) return;
    lastCheck = now();
    void bestEffort("foreground update check", downloadUpdate());
  });
  return () => subscription.remove();
}
