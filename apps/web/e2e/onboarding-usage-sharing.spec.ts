import { expect, test } from "@playwright/test";
import { captureScreenshot, openUserSettings, signup } from "./helpers";

test("a new user chooses data sharing first and finds the choice in Settings", async ({
  page,
}, testInfo) => {
  await signup(page, `sharing-${Date.now()}@robots.test`, "password12", "Sharing");

  await expect(page.getByRole("heading", { name: "Enable data sharing" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/sharing$/);
  await expect(page.getByText("Help make RoBots better for everyone")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Share data" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "https://tryrobots.app/privacy/",
  );
  await captureScreenshot(page, testInfo, "01-data-sharing-off");

  await toggle.click();
  await expect(toggle).toBeChecked();
  await captureScreenshot(page, testInfo, "02-data-sharing-on");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });

  await page.reload();
  await page.waitForURL(/\/app\//);
  await expect(page.getByRole("heading", { name: "Enable data sharing" })).toHaveCount(0);
  const settings = await openUserSettings(page);
  const setting = settings.getByTestId("usage-sharing-toggle");
  await setting.scrollIntoViewIfNeeded();
  await expect(setting).toBeChecked();
  await captureScreenshot(page, testInfo, "03-settings-on");

  await setting.click();
  await expect(setting).not.toBeChecked();
  await page.reload();
  const reopened = await openUserSettings(page);
  await expect(reopened.getByTestId("usage-sharing-toggle")).not.toBeChecked();
});

test("continuing without touching the switch leaves data sharing off", async ({ page }) => {
  await signup(page, `sharing-off-${Date.now()}@robots.test`, "password12", "SharingOff");

  await expect(page.getByRole("heading", { name: "Enable data sharing" })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });

  await page.goto("/onboarding");
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Enable data sharing" })).toHaveCount(0);
  const settings = await openUserSettings(page);
  await expect(settings.getByTestId("usage-sharing-toggle")).not.toBeChecked();
});
