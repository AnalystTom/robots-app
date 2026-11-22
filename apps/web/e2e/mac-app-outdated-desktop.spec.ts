import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, signup } from "./helpers";

test("Mail asks to update RoBots when the Mac app predates Mac apps", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `mac-app-outdated-${Date.now()}@robots.test`, "password12", "Sample");
  await completeOnboarding(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "robotsDesktop", {
      value: {
        platform: "darwin",
        device: { state: async () => null, setAllowed: async () => null },
        window: {
          close: async () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
        },
        oauth: { onCallback: () => () => {} },
        update: { state: async () => ({ phase: "idle", currentVersion: "0.11.0" }) },
      },
    });
  });
  await page.goto(`/app/${activeBotId(page)}?integrations=`);
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true });
  await dialog.getByTestId("mac-apps").getByRole("button", { name: "Mail", exact: true }).click();

  const access = page.getByTestId("connection-accounts");
  await expect(access.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  const grant = page.getByTestId("mac-grant").filter({ hasText: "Control Mail" });
  await expect(grant).toBeVisible();
  await captureScreenshot(page, testInfo, "mac-app-outdated-desktop");

  await expect(
    grant.getByText("Update RoBots on this Mac to allow", { exact: true }),
  ).toBeVisible();
  await expect(grant.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
});
