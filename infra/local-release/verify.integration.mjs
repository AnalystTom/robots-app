import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const { chromium } = createRequire(new URL("../../apps/web/package.json", import.meta.url))(
  "@playwright/test",
);
const baseURL = process.argv[2];
if (new URL(baseURL).hostname !== "127.0.0.1") throw new Error("Verify a local installation");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const email = `local-${randomUUID()}@example.test`;
  const password = randomUUID();
  async function rpc(route, json = {}) {
    const response = await context.request.post(`/rpc/${route}`, {
      data: { json },
      headers: { origin: baseURL },
    });
    assert.equal(response.status(), 200, route);
    return (await response.json()).json;
  }
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("Local tester");
  await page.getByPlaceholder("Your email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL(/\/(app|onboarding)/);
  const me = await rpc("me");
  assert.equal(me.billingEnabled, false);
  const bot = await rpc("bots/create", { name: "Local helper" });
  assert.ok(bot.id);
  await context.clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(app|onboarding)/);
  assert.equal((await rpc("me")).spaceId, me.spaceId);
  const bots = await rpc("bots/list");
  assert.ok(bots.some((entry) => entry.id === bot.id));
  console.log("Free local signup, bot creation, fresh sign-in and workspace persistence passed.");
} finally {
  await browser.close();
}
