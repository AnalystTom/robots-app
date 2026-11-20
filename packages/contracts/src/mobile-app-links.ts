export const MOBILE_PLATFORMS = ["ios", "android"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export const MOBILE_APP_LINKS: Readonly<Partial<Record<MobilePlatform, string>>> = {};
