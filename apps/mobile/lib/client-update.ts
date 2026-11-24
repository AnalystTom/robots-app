import { t } from "@lingui/core/macro";
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
import { bestEffort } from "./best-effort";

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

async function checkOverTheAirUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  return (await Updates.checkForUpdateAsync()).isAvailable;
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

async function openServerInBrowser(): Promise<void> {
  await bestEffort("open server in browser", Linking.openURL(currentApiBase()));
}

let prompting = false;

function alertUpdateRequired(
  message: string | undefined,
  label: string,
  action: () => Promise<void>,
): void {
  Alert.alert(
    t`Update required`,
    message,
    [
      {
        text: label,
        onPress: () => {
          void action().finally(() => {
            prompting = false;
          });
        },
      },
    ],
    { cancelable: false },
  );
}

export function noteClientUpdateRequired(): void {
  if (prompting) return;
  prompting = true;
  if (storeListing()) {
    alertUpdateRequired(undefined, t`Update`, applyRequiredUpdate);
    return;
  }
  void bestEffort("check over-the-air update", checkOverTheAirUpdate()).then((available) => {
    if (available) {
      alertUpdateRequired(undefined, t`Update`, applyRequiredUpdate);
      return;
    }
    alertUpdateRequired(
      t`This version of RoBots is no longer supported, and an update is not in the app store yet.`,
      t`Open on the web`,
      openServerInBrowser,
    );
  });
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
