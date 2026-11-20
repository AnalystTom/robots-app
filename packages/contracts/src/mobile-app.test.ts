import { afterEach, describe, expect, it, vi } from "vitest";
import type * as MobileAppLinks from "./mobile-app-links.js";

const links = vi.hoisted((): { ios?: string; android?: string } => ({}));

vi.mock("./mobile-app-links.js", async (importOriginal) => ({
  ...(await importOriginal<typeof MobileAppLinks>()),
  MOBILE_APP_LINKS: links,
}));

import { listedMobileApps, mobileAppLinkFor } from "./mobile-app.js";

afterEach(() => {
  delete links.ios;
  delete links.android;
});

describe("mobile app links", () => {
  it("offers no mobile app while RoBots has no store listing", () => {
    expect(listedMobileApps()).toEqual([]);
    for (const userAgent of ["Android", "iPhone", "Macintosh"]) {
      expect(mobileAppLinkFor(userAgent, 0)).toBeUndefined();
    }
  });

  it("lists each platform's own store and offers it only to that platform", () => {
    links.ios = "https://ios.example/app";
    links.android = "https://android.example/app";
    expect(listedMobileApps()).toEqual([
      { platform: "ios", href: "https://ios.example/app" },
      { platform: "android", href: "https://android.example/app" },
    ]);
    expect(mobileAppLinkFor("Linux; Android 15", 0)).toBe("https://android.example/app");
    expect(mobileAppLinkFor("iPhone", 5)).toBe("https://ios.example/app");
    expect(mobileAppLinkFor("Macintosh", 0)).toBeUndefined();
    expect(mobileAppLinkFor("Macintosh", 5)).toBe("https://ios.example/app");
  });

  it("offers nothing to a platform whose store is not listed", () => {
    links.ios = "https://ios.example/app";
    expect(listedMobileApps()).toEqual([{ platform: "ios", href: "https://ios.example/app" }]);
    expect(mobileAppLinkFor("Android", 0)).toBeUndefined();
    expect(mobileAppLinkFor("iPhone", 0)).toBe("https://ios.example/app");
  });
});
