import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_APP_LINKS, mobileAppLinkFor } from "./mobile-app.js";

const STORE_LINK = /https:\/\/(?:apps\.apple\.com|play\.google\.com)\/[^\s)"'`]+/g;
const DOCS = ["../../../docs/mobile-app.md", "../../../docs/mobile-release.md"];

describe("mobile app links", () => {
  it("offers no mobile app while RoBots has no store listing", () => {
    expect(MOBILE_APP_LINKS).toEqual({});
    for (const userAgent of ["Android", "iPhone", "Macintosh"]) {
      expect(mobileAppLinkFor(userAgent)).toBeUndefined();
    }
  });

  it("picks the visitor's store, then the other one", () => {
    const both = { ios: "https://ios.example/app", android: "https://android.example/app" };
    expect(mobileAppLinkFor("Linux; Android 15", both)).toBe(both.android);
    expect(mobileAppLinkFor("iPhone", both)).toBe(both.ios);
    expect(mobileAppLinkFor("Macintosh", both)).toBe(both.ios);
    expect(mobileAppLinkFor("Android", { ios: both.ios })).toBe(both.ios);
    expect(mobileAppLinkFor("iPhone", { android: both.android })).toBe(both.android);
  });

  it.each(DOCS)("%s names only the listed stores", (path) => {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    const listed = Object.values(MOBILE_APP_LINKS);
    expect((text.match(STORE_LINK) ?? []).filter((link) => !listed.includes(link))).toEqual([]);
  });
});
