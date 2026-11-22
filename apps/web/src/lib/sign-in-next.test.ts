import { expect, it } from "vitest";
import { newAccountDestination, onboardingTemplate, signInNext } from "./sign-in-next.js";

const next = (value: string | null) =>
  signInNext(new URLSearchParams(value === null ? "" : { next: value }));

it("returns to integration setup, plugin admin, MCP sign-in, invite, app and template links only", () => {
  expect(next("/integrations/setup")).toBe("/integrations/setup");
  expect(next("/admin/plugins")).toBe("/admin/plugins");
  expect(next("/mcp/oauth/callback?code=c&state=s")).toBe("/mcp/oauth/callback?code=c&state=s");
  expect(next("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
  expect(next("/templates/refund-bot")).toBe("/templates/refund-bot");
  expect(next(null)).toBeNull();
  expect(next("/app")).toBe("/app");
  expect(next("/app/today")).toBe("/app/today");
  expect(next("/app/x/link-1?tab=files&q=a%20b")).toBe("/app/x/link-1?tab=files&q=a%20b");
  expect(next("/apps")).toBeNull();
  expect(next("/app//example.com")).toBeNull();
  expect(next("/app/../admin")).toBeNull();
  expect(next("/app\\example.com")).toBeNull();
  expect(next("/onboarding")).toBeNull();
  expect(next("https://example.com/invite/abc")).toBeNull();
  expect(next("//example.com/invite/abc")).toBeNull();
  expect(next("/invite/abc/../../app")).toBeNull();
  expect(next("/invite/")).toBeNull();
  expect(next("/templates/../app")).toBeNull();
  expect(next("/templates/Refund_Bot")).toBeNull();
});

it("turns a website template link into the template's import page", () => {
  expect(signInNext(new URLSearchParams("template=chief-of-staff"))).toBe(
    "/templates/chief-of-staff",
  );
  expect(signInNext(new URLSearchParams("template=chief-of-staff&next=/admin/plugins"))).toBe(
    "/templates/chief-of-staff",
  );
  expect(signInNext(new URLSearchParams("template=../app"))).toBeNull();
  expect(signInNext(new URLSearchParams("template=https://example.com"))).toBeNull();
  expect(signInNext(new URLSearchParams(`template=${"a".repeat(65)}`))).toBeNull();
});

it("starts a new account in onboarding, keeping an invite or a template it came for", () => {
  expect(newAccountDestination("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
  expect(newAccountDestination("/templates/gtm")).toBe("/onboarding?template=gtm");
  expect(newAccountDestination("/integrations/setup")).toBe("/onboarding");
  expect(newAccountDestination(null)).toBe("/onboarding");
  expect(onboardingTemplate(new URLSearchParams("template=gtm"))).toBe("gtm");
  expect(onboardingTemplate(new URLSearchParams("template=Not/A/Slug"))).toBeNull();
});
