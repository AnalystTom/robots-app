import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  openBotPanelTab,
  rpc,
  signup,
} from "./helpers";

test.use({ colorScheme: "dark" });

const botFastMode = (page: Page, botId: string) =>
  rpc<{ fastMode: boolean }>(page, "bots/get", { botId }).then(({ fastMode }) => fastMode);

test("Fast mode is chosen in the composer, kept after a reload and hidden where it does not apply", async ({
  page,
}, testInfo) => {
  await signup(page, `fast-mode-${Date.now()}@robots.test`, "password12", "Fast Mode");
  await completeOnboarding(page);
  await rpc(page, "models/connect", {
    provider: "openai",
    apiKey: "fake-openai-key",
    modelId: "gpt-6.1-sol",
    makeDefault: false,
  });
  const botId = await createNamedBot(page, "Sprinter");

  await page.getByRole("button", { name: "Model: Auto" }).click();
  const fast = page.getByRole("menuitemcheckbox", { name: /^Fast/ });
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await expect(fast).toContainText("Faster replies, uses more of your plan");
  await captureScreenshot(page, testInfo, "composer-fast-off");
  await fast.click();
  await expect(fast).toHaveAttribute("aria-checked", "true");
  await captureScreenshot(page, testInfo, "composer-fast-on");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Model: Auto · Fast" })).toBeVisible();
  await expect.poll(() => botFastMode(page, botId)).toBe(true);
  await captureScreenshot(page, testInfo, "composer-trigger-fast");

  await page.reload();
  await expect(page.getByRole("button", { name: "Model: Auto · Fast" })).toBeVisible();
  await openBotPanelTab(page, "Advanced");
  const settingsSwitch = page.getByTestId("bot-settings").getByRole("switch", { name: "Fast" });
  await expect(settingsSwitch).toBeChecked();
  await captureScreenshot(page, testInfo, "bot-settings-fast");

  await page.route("**/rpc/bots/update", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Model: Auto · Fast" }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Fast/ }).click();
  await expect(page.getByText("Could not reach the server").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Model: Auto · Fast" })).toBeVisible();
  await page.unroute("**/rpc/bots/update");
  expect(await botFastMode(page, botId)).toBe(true);

  await rpc(page, "models/connect", {
    provider: "anthropic",
    apiKey: "fake-anthropic-key",
    modelId: "claude-haiku-5-5",
    makeDefault: false,
  });
  await page.reload();
  const trigger = page.getByRole("button", { name: /^Model: / });
  await expect(trigger).toHaveAccessibleName("Model: Auto");
  await trigger.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: /^Fast/ })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "composer-anthropic-no-fast");
  await page.keyboard.press("Escape");
  await openBotPanelTab(page, "Advanced");
  await expect(page.getByTestId("bot-settings").getByRole("switch", { name: "Fast" })).toHaveCount(
    0,
  );
  expect(await botFastMode(page, botId)).toBe(true);

  await trigger.click();
  await page.getByRole("menuitemcheckbox", { name: "Advanced" }).click();
  await page.getByRole("menuitem", { name: /^Provider/ }).click();
  await page.getByRole("menuitemradio", { name: "OpenAI", exact: true }).click();
  await expect(trigger).toHaveAccessibleName(/^Model: .+ · Fast$/);
  await expect
    .poll(() => rpc<{ modelProvider: string | null }>(page, "bots/get", { botId }))
    .toMatchObject({ modelProvider: "openai" });
});
