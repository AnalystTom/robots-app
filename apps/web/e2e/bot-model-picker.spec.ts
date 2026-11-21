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

type BotModel = { modelProvider: string | null; modelId: string | null };

async function connectWithoutChoosingDefault(page: Page) {
  await rpc(page, "models/connect", {
    provider: "anthropic",
    apiKey: "fake-anthropic-key",
    modelId: "claude-haiku-5-5",
    makeDefault: false,
  });
}

const botModel = (page: Page, botId: string) =>
  rpc<BotModel>(page, "bots/get", { botId }).then(({ modelProvider, modelId }) => ({
    modelProvider,
    modelId,
  }));

test("a new bot's Space default names the connected model it runs", async ({ page }, testInfo) => {
  await signup(page, `space-default-${Date.now()}@robots.test`, "password12", "Default Model");
  await completeOnboarding(page);
  await connectWithoutChoosingDefault(page);
  await createNamedBot(page, "Scout");
  await openBotPanelTab(page, "Advanced");
  const model = page.getByTestId("bot-settings").locator('[id$="-model"]');
  await expect(model).toContainText("Space default · Claude Haiku 5.5");
  await captureScreenshot(page, testInfo, "space-default-resolved-model");
});

test("the composer switches a bot between Lite, Auto and Pro at once", async ({
  page,
}, testInfo) => {
  await signup(page, `composer-tier-${Date.now()}@robots.test`, "password12", "Tier Picker");
  await completeOnboarding(page);
  await connectWithoutChoosingDefault(page);
  const botId = await createNamedBot(page, "Writer");
  const trigger = page.getByRole("button", { name: "Model: Auto" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: /^Auto/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await captureScreenshot(page, testInfo, "composer-model-picker-open");
  await menu.getByRole("menuitemradio", { name: /^Pro/ }).click();
  await expect(page.getByRole("button", { name: "Model: Pro" })).toBeVisible();
  await expect.poll(() => botModel(page, botId)).toMatchObject({ modelProvider: "anthropic" });
  const pro = await botModel(page, botId);
  expect(pro.modelId).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("button", { name: "Model: Pro" })).toBeVisible();
  await page.getByRole("button", { name: "Model: Pro" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Advanced" }).click();
  await page.getByRole("menuitem", { name: /^Model/ }).click();
  await captureScreenshot(page, testInfo, "composer-model-picker-advanced");
  await page.getByRole("menuitemradio", { name: "Claude Haiku 5.5", exact: true }).click();
  await expect
    .poll(() => botModel(page, botId))
    .toEqual({
      modelProvider: "anthropic",
      modelId: "claude-haiku-5-5",
    });

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Model: Lite" })).toBeVisible();
  await page.getByRole("button", { name: "Model: Lite" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitemradio", { name: /^Auto/ }).click();
  await expect(page.getByRole("button", { name: "Model: Auto" })).toBeVisible();
  await expect.poll(() => botModel(page, botId)).toEqual({ modelProvider: null, modelId: null });
});

test("choosing a bot's model in its settings saves without a Save step", async ({ page }) => {
  await signup(page, `instant-model-${Date.now()}@robots.test`, "password12", "Instant Save");
  await completeOnboarding(page);
  await connectWithoutChoosingDefault(page);
  const botId = await createNamedBot(page, "Planner");
  await openBotPanelTab(page, "Advanced");
  const settings = page.getByTestId("bot-settings");
  const model = settings.locator('[id$="-model"]');
  await model.click();
  await page.getByRole("combobox", { name: "Search models" }).fill("Sonnet 5.5");
  await page
    .getByRole("option", { name: /Claude Sonnet 5\.5/ })
    .first()
    .click();
  await expect(model).toContainText("Claude Sonnet 5.5");
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect
    .poll(() => botModel(page, botId))
    .toEqual({
      modelProvider: "anthropic",
      modelId: "claude-sonnet-5-5",
    });

  await page.reload();
  await openBotPanelTab(page, "Advanced");
  const reloaded = page.getByTestId("bot-settings").locator('[id$="-model"]');
  await expect(reloaded).toContainText("Claude Sonnet 5.5");

  await page.route("**/rpc/bots/update", (route) => route.abort("failed"));
  await reloaded.click();
  await page.getByRole("combobox", { name: "Search models" }).fill("Opus 5.5");
  await page.getByRole("option", { name: /Claude Opus 5\.5/ }).first().click();
  await expect(page.getByText("Could not reach the server").first()).toBeVisible();
  await expect(reloaded).toContainText("Claude Sonnet 5.5");
  await page.unroute("**/rpc/bots/update");
  expect(await botModel(page, botId)).toEqual({
    modelProvider: "anthropic",
    modelId: "claude-sonnet-5-5",
  });
});
