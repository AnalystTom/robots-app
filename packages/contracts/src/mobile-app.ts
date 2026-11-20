import { MOBILE_APP_LINKS, MOBILE_PLATFORMS } from "./mobile-app-links.js";
import type { MobilePlatform } from "./mobile-app-links.js";

export { MOBILE_APP_LINKS, MOBILE_PLATFORMS } from "./mobile-app-links.js";
export type { MobilePlatform } from "./mobile-app-links.js";

export function listedMobileApps(): Array<{ platform: MobilePlatform; href: string }> {
  return MOBILE_PLATFORMS.flatMap((platform) => {
    const href = MOBILE_APP_LINKS[platform];
    return href ? [{ platform, href }] : [];
  });
}

export function mobileAppLinkFor(userAgent: string, maxTouchPoints: number): string | undefined {
  if (/Android/i.test(userAgent)) return MOBILE_APP_LINKS.android;
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return MOBILE_APP_LINKS.ios;
  }
  return undefined;
}
