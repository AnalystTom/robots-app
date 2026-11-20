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
import { configureClientBuild } from "./api";

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

export async function applyRequiredUpdate(): Promise<void> {
  try {
    if (await downloadUpdate()) {
      await Updates.reloadAsync();
      return;
    }
  } catch {}
  const listing = MOBILE_APP_LINKS[Platform.OS === "ios" ? "ios" : "android"];
  if (listing) await Linking.openURL(listing).catch(() => undefined);
}

let prompting = false;

export function noteClientUpdateRequired(): void {
  if (prompting) return;
  prompting = true;
  Alert.alert(
    t`Update required`,
    undefined,
    [
      {
        text: t`Update`,
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
    void downloadUpdate().catch(() => undefined);
  });
  return () => subscription.remove();
}
