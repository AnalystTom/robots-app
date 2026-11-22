import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openBotPanelTab, rpc, signup } from "./helpers";

test("bot settings open Avatar Studio on the Bot tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@robots.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await rpc(page, "preferences/update", { botAvatarSet: "organic" });
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
  const detective = characters.getByRole("radio", { name: "Detective", exact: true });
  await detective.click();
  await expect(detective).toHaveAttribute("aria-checked", "true");
  await expect(studio.locator('img[src^="data:image/svg+xml"]').first()).toBeVisible();
  await captureScreenshot(page, testInfo, "avatar-studio-robot-characters");

  await studio.getByText("More styles", { exact: true }).click();
  await expect(studio.getByRole("tab", { name: "Original", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const defaultLook = studio.getByTestId("avatar-studio-default");
  const wedge = studio.getByRole("button", { name: "wedge", exact: true });
  await expect(defaultLook).toHaveAttribute("aria-pressed", "false");
  await defaultLook.click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");

  await wedge.click();
  await expect(wedge).toHaveAttribute("aria-pressed", "true");
  await expect(defaultLook).toHaveAttribute("aria-pressed", "false");
  await expect(studio.locator(".robots-organic-avatar")).toHaveCount(0);

  await defaultLook.click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");
  await expect(studio.locator(".robots-organic-avatar")).toHaveCount(1);
  await expect(studio.locator(".robots-organic-avatar-eyes").first()).toBeVisible();

  await studio.getByRole("button", { name: "Color #FFAF38" }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");

  await wedge.click();
  await studio.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(wedge).toHaveAttribute("aria-pressed", "false");
  await expect(studio.locator(".robots-organic-avatar")).toHaveCount(1);

  await captureScreenshot(page, testInfo, "avatar-studio-bot-tab");
  await studio.getByRole("tab", { name: "RoBots", exact: true }).click();
  await expect(studio.locator(".robots-logo-avatar").first()).toBeVisible();
  await studio.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await openBotPanelTab(page, "Computer");
  await page.getByTestId("bot-settings").getByTestId("avatar-studio-trigger").click();
  await expect(
    page.getByTestId("avatar-studio").getByRole("tab", { name: "RoBots", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await captureScreenshot(page, testInfo, "avatar-studio-robots-set");
});
