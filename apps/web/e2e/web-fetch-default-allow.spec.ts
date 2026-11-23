import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

async function sendAsNewUser(page: Page, name: string, message: string) {
  await signup(page, `${name}-${Date.now()}@robots.test`, "password12", "Web Fetch");
  await completeOnboarding(page);
  await page.getByPlaceholder(/Message/).fill(message);
  await page.keyboard.press("Enter");
}

test("reads an ordinary public page without asking", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("robots.showToolActivity") == null)
      localStorage.setItem("robots.showToolActivity", "on");
  });
  await sendAsNewUser(page, "public-fetch", "read the public fixture page");

  await expect(page.getByTestId("transcript").getByText("done.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
  await expect(page.getByText("url: https://example.com/")).toHaveCount(0);
  const card = page.getByTestId("tool-activity");
  await expect(card).toHaveCount(1);
  await card.locator("button[aria-expanded]").click();
  await expect(page.getByTestId("tool-rows")).toContainText("Web fetch");
  await captureScreenshot(page, testInfo, "web-fetch-public-page");
});

test("still asks before reading a cloud metadata address", async ({ page }, testInfo) => {
  await sendAsNewUser(page, "metadata-fetch", "read the metadata fixture page");

  await expect(page.getByText("url: http://169.254.169.254/latest/meta-data/")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "web-fetch-metadata-card");
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.getByTestId("transcript").getByText("Denied", { exact: true })).toBeVisible();
});
