import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openNewBot,
  openUserSettings,
  rpc,
  signup,
} from "./helpers";

test("bot style stays available when bootstrap omits the saved preference", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.json.me.botAvatarSet;
    await route.fulfill({ response, json: body });
  });
  await signup(page, `bot-style-${Date.now()}@robots.test`, "password12", "Tester");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  const picker = settings.getByTestId("bot-style-select");
  const original = picker.getByRole("button", { name: "Original", exact: true });
  const robots = picker.getByRole("button", { name: "RoBots", exact: true });
  await expect(original).toBeVisible();
  await expect(original).toHaveAttribute("aria-pressed", "false");
  await robots.click();
  await expect(robots).toHaveAttribute("aria-pressed", "true");
  await original.click();
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await captureScreenshot(page, testInfo, "bot-style-original");
  await page.unroute("**/rpc/bootstrap");
  await page.reload();
  await openUserSettings(page);
  await expect(
    page.getByTestId("bot-style-select").getByRole("button", { name: "Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a new account starts on RoBots and an Original account keeps Original", async ({
  page,
}, testInfo) => {
  await signup(page, `bot-style-default-${Date.now()}@robots.test`, "password12", "Tester");
  await completeOnboarding(page);
  expect((await rpc<{ botAvatarSet?: string }>(page, "me", {})).botAvatarSet).toBe("robots");
  await openNewBot(page);
  const dialog = page.getByTestId("create-bot-dialog");
  await expect(dialog.locator(".robots-logo-avatar").first()).toBeVisible();
  await expect(dialog.locator(".robots-organic-avatar")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "new-bot-robots-default");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  await rpc(page, "preferences/update", { botAvatarSet: "organic" });
  await page.reload();
  expect((await rpc<{ botAvatarSet?: string }>(page, "me", {})).botAvatarSet).toBe("organic");
  await openNewBot(page);
  await expect(dialog.locator(".robots-organic-avatar").first()).toBeVisible();
  await expect(dialog.locator(".robots-logo-avatar")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "new-bot-original-kept");
});
