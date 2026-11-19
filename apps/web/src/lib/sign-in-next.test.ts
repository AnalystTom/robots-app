import { expect, it } from "vitest";
import { newAccountDestination, signInNext } from "./sign-in-next.js";

it("returns to integration setup, plugin admin, MCP sign-in, invite and app links only", () => {
  expect(signInNext("/integrations/setup")).toBe("/integrations/setup");
  expect(signInNext("/admin/plugins")).toBe("/admin/plugins");
  expect(signInNext("/mcp/oauth/callback?code=c&state=s")).toBe(
    "/mcp/oauth/callback?code=c&state=s",
  );
  expect(signInNext("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
  expect(signInNext(null)).toBeNull();
  expect(signInNext("/app")).toBe("/app");
  expect(signInNext("/app/today")).toBe("/app/today");
  expect(signInNext("/app/x/link-1?tab=files&q=a%20b")).toBe("/app/x/link-1?tab=files&q=a%20b");
  expect(signInNext("/apps")).toBeNull();
  expect(signInNext("/app//example.com")).toBeNull();
  expect(signInNext("/app/../admin")).toBeNull();
  expect(signInNext("/app\\example.com")).toBeNull();
  expect(signInNext("/onboarding")).toBeNull();
  expect(signInNext("https://example.com/invite/abc")).toBeNull();
  expect(signInNext("//example.com/invite/abc")).toBeNull();
  expect(signInNext("/invite/abc/../../app")).toBeNull();
  expect(signInNext("/invite/")).toBeNull();
});

it("starts a new account in onboarding unless it came for an invite", () => {
  expect(newAccountDestination("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
  expect(newAccountDestination("/integrations/setup")).toBe("/onboarding");
  expect(newAccountDestination(null)).toBe("/onboarding");
});
