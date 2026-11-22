import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Bot, BotTemplateListing } from "@robots/contracts";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openEmailSignIn,
  rpc,
  signup,
} from "./helpers";

async function expectTemplateBot(page: Page, templateId: string, name: string) {
  await page.waitForURL(/\/app\/[^/?]+/, { timeout: 30_000 });
  const botId = activeBotId(page);
  const templates = await rpc<BotTemplateListing[]>(page, "bots/templates", {});
  const template = templates.find((item) => item.id === templateId)!;
  const bot = await rpc<Bot>(page, "bots/get", { botId });
  expect([bot.name, bot.color, template.botId]).toEqual([name, template.avatar, botId]);
  await expect(page.getByRole("combobox", { name: `Message ${name}` })).toBeVisible();
  return botId;
}

test("a website template link signs a new person up and gives them that bot", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/sign-up?template=refund-bot");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await openEmailSignIn(page);
  await page.getByPlaceholder("Your name").fill("Template Link");
  await page.getByPlaceholder("Your email address").fill(`link-up-${Date.now()}@robots.test`);
  await page.getByPlaceholder("Password").fill("password12");
  await page.getByRole("button", { name: "Create account" }).click();

  await expectTemplateBot(page, "refund-bot", "Refund Bot");
  const bots = await rpc<Bot[]>(page, "bots/list", {});
  expect(bots.map((bot) => bot.name)).toEqual(["Refund Bot"]);
  await captureScreenshot(page, testInfo, "template-link-sign-up");
});

test("the website's team link signs a returning person in and sets up the whole crew once", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const email = `link-in-${Date.now()}@robots.test`;
  await signup(page, email, "password12", "Template Link");
  await completeOnboarding(page);

  await page.context().clearCookies();
  await page.goto("/sign-in?template=team-autopilot");
  await openEmailSignIn(page);
  await page.getByPlaceholder("Your email address").fill(email);
  await page.getByPlaceholder("Password").fill("password12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const botId = await expectTemplateBot(page, "chief-of-staff", "Chief of Staff");
  const crew = ["Chief of Staff", "Dev", "Researcher", "Sales", "GTM", "Refund Bot"];
  const named = async () =>
    (await rpc<Bot[]>(page, "bots/list", {}))
      .map((bot) => bot.name)
      .filter((name) => crew.includes(name));
  expect((await named()).sort()).toEqual([...crew].sort());
  await captureScreenshot(page, testInfo, "template-link-team");

  await page.goto("/sign-in?template=team-autopilot");
  await page.waitForURL(new RegExp(`/app/${botId}$`), { timeout: 30_000 });
  expect(await named()).toHaveLength(6);

  await page.goto("/sign-in?template=not-a-template");
  await expect(page.getByRole("dialog", { name: "RoBot templates", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
