import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

type VaultRow = { name: string; title: string; note: string; auth: { type: string } | null };

test("imports a browser sign-in from the desktop app into the vault and removes it", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const reads: Array<{ profileId: string; sites: string[] }> = [];
    Object.defineProperty(window, "__sessionReads", { value: reads });
    Object.defineProperty(window, "robotsDesktop", {
      value: {
        platform: "linux",
        window: {
          close: async () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
        },
        oauth: { onCallback: () => () => {} },
        update: {
          state: async () => ({ phase: "unsupported", currentVersion: "0.11.0" }),
          check: async () => ({ phase: "unsupported", currentVersion: "0.11.0" }),
          download: async () => ({ phase: "unsupported", currentVersion: "0.11.0" }),
          install: async () => ({ phase: "unsupported", currentVersion: "0.11.0" }),
        },
        browserSessions: {
          profiles: async () => [
            {
              id: "chrome/0/Default",
              name: "Thomas",
              browser: "Chrome",
              sites: [
                { site: "example.org", cookies: 3 },
                { site: "x.com", cookies: 2 },
              ],
            },
          ],
          read: async (profileId: string, sites: string[]) => {
            reads.push({ profileId, sites });
            return {
              ok: true,
              sessions: sites.map((site) => ({
                site,
                cookies: [
                  {
                    name: "auth_token",
                    value: "fake-e2e-session-token",
                    domain: site,
                    hostOnly: false,
                    path: "/",
                    secure: true,
                    httpOnly: true,
                    sameSite: "None",
                    expires: Math.floor(Date.now() / 1000) + 86_400,
                  },
                ],
              })),
            };
          },
        },
      },
    });
  });
  const stamp = Date.now();
  await signup(page, `session-import-${stamp}@robots.test`, "password12", "Session Tester");
  await completeOnboarding(page);
  const settings = await openUserSettings(page, "vault");
  await settings.getByTestId("vault-new").click();
  await captureScreenshot(page, testInfo, "vault-new-menu-desktop");
  await page.getByTestId("vault-import-sessions").click();

  const importPage = settings.getByTestId("vault-session-import");
  await expect(importPage.getByText("Thomas in Chrome")).toBeVisible();
  const sites = importPage.getByTestId("vault-session-site");
  await expect(sites).toHaveCount(2);
  for (const site of await sites.all()) await expect(site).not.toBeChecked();
  const submit = importPage.getByTestId("vault-session-import-submit");
  await expect(submit).toBeDisabled();
  await importPage.locator('[data-site="x.com"]').click();
  await captureScreenshot(page, testInfo, "vault-session-import");
  await submit.click();

  await expect(importPage.getByTestId("vault-session-delivery")).toContainText(
    /Signs in when its computer|Signed in/,
  );
  expect(
    await page.evaluate(() => (window as unknown as { __sessionReads: unknown[] }).__sessionReads),
  ).toEqual([{ profileId: "chrome/0/Default", sites: ["x.com"] }]);
  await importPage.getByRole("button", { name: "Done" }).click();

  const row = settings.getByTestId("vault-credential-row").filter({ hasText: "x.com" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Thomas in Chrome");
  const saved = await rpc<VaultRow[]>(page, "vault/list", {});
  const item = saved.find((entry) => entry.title === "x.com");
  expect(item?.auth).toEqual({ type: "session" });
  await captureScreenshot(page, testInfo, "vault-session-item");

  await row.click();
  const detail = settings.getByTestId("vault-item-detail");
  await expect(detail.getByText("Imported from")).toBeVisible();
  await expect(detail.getByTestId("vault-item-access-detail")).toContainText("Chief");
  await expect(detail.getByTestId("vault-item-edit")).toHaveCount(0);
  await expect(detail.getByTestId("vault-item-show")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "vault-session-detail");
  await detail.getByTestId("vault-item-remove").click();
  await detail.getByTestId("vault-item-remove-confirm").click();
  await expect(
    settings.getByTestId("vault-credential-row").filter({ hasText: "x.com" }),
  ).toHaveCount(0);
  const after = await rpc<VaultRow[]>(page, "vault/list", {});
  expect(after.some((entry) => entry.auth?.type === "session")).toBe(false);
});

test("the web app offers no browser sign-in import", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `session-web-${stamp}@robots.test`, "password12", "Web Tester");
  await completeOnboarding(page);
  const settings = await openUserSettings(page, "vault");
  await settings.getByTestId("vault-new").click();
  await expect(page.getByTestId("vault-import")).toBeVisible();
  await expect(page.getByTestId("vault-import-sessions")).toHaveCount(0);
});
