import { MOBILE_APP_LINKS } from "@robots/contracts";
import { bestEffort } from "@robots/logging";
import { useQuery } from "@tanstack/react-query";
import * as Application from "expo-application";
import { Linking, Platform } from "react-native";
import { queryClient } from "./query";

const STORE_LOOKUP_URL = "https://itunes.apple.com/lookup";
const IOS_LISTING = MOBILE_APP_LINKS.ios;

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (value: string) =>
    /^\d+(\.\d+)*$/.test(value) ? value.split(".").map(Number) : null;
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff > 0;
  }
  return false;
}

export async function fetchStoreVersion(bundleId: string): Promise<string | null> {
  const response = await fetch(
    `${STORE_LOOKUP_URL}?bundleId=${encodeURIComponent(bundleId)}&_=${Date.now()}`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: Array<{ version?: unknown }> };
  const version = body.results?.[0]?.version;
  return typeof version === "string" ? version : null;
}

export function useStoreUpdate(): (() => void) | null {
  const bundleId = Platform.OS === "ios" && IOS_LISTING ? Application.applicationId : null;
  const installed = Application.nativeApplicationVersion;
  const { data } = useQuery(
    {
      queryKey: ["store-version", bundleId],
      queryFn: () => fetchStoreVersion(bundleId ?? ""),
      enabled: Boolean(bundleId && installed),
      staleTime: 60 * 60_000,
    },
    queryClient,
  );
  const listing = IOS_LISTING;
  if (!listing || !data || !installed || !isNewerVersion(data, installed)) return null;
  return () => void bestEffort("open store listing", Linking.openURL(listing));
}
