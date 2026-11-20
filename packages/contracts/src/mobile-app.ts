export const MOBILE_PLATFORMS = ["ios", "android"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];
export type MobileAppLinks = Readonly<Partial<Record<MobilePlatform, string>>>;

export const MOBILE_APP_LINKS: MobileAppLinks = {};

export function mobileAppLinkFor(
  userAgent: string,
  links: MobileAppLinks = MOBILE_APP_LINKS,
): string | undefined {
  return /Android/i.test(userAgent) ? (links.android ?? links.ios) : (links.ios ?? links.android);
}
