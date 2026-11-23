import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("bot settings open Avatar Studio on the Bot tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@robots.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings).toBeVisible();

  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(studio.getByText("Avatar Studio", { exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Bot", exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Upload", exact: true })).toBeVisible();
  await expect(studio.getByTestId("avatar-studio-bot-tab")).toBeVisible();

  const characters = studio.getByRole("radiogroup", { name: "Character" });
  await expect(characters.getByRole("radio")).not.toHaveCount(0);
  await expect(studio.getByRole("button", { name: "Shuffle" })).toHaveCount(0);
  await expect(studio.getByRole("group", { name: "Headwear" })).toHaveCount(0);
  const detective = characters.getByRole("radio", { name: "Detective", exact: true });
  await detective.click();
  await expect(detective).toHaveAttribute("aria-checked", "true");
  await expect(characters.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(studio.locator('img[src^="data:image/svg+xml"]').first()).toBeVisible();
  await captureScreenshot(page, testInfo, "avatar-studio-robot-list");

  await expect(studio.getByText("More styles", { exact: true })).toHaveCount(0);
  await expect(studio.getByRole("tab", { name: "Original", exact: true })).toHaveCount(0);
  await expect(studio.getByRole("tab", { name: "RoBots", exact: true })).toHaveCount(0);
  await expect(studio.getByRole("button", { name: "wedge", exact: true })).toHaveCount(0);
  await expect(studio.locator(".robots-organic-avatar")).toHaveCount(0);
  await expect(studio.locator(".robots-logo-avatar")).toHaveCount(0);
  await expect(characters.getByRole("radio")).toHaveCount(15);
  await studio.getByRole("button", { name: "Done", exact: true }).click();
});
