import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { signupThroughForm } from "../../e2e/helpers";

const hosted = "http://localhost:5194";
const local = "http://127.0.0.1:5193";
const setup = "/api/registration";

function account() {
  return { email: `tester-${randomUUID()}@example.test`, password: randomUUID() };
}

function rpc(request: APIRequestContext, origin: string, path: string, json = {}, space?: string) {
  return request.post(`${origin}/rpc/${path}`, {
    headers: { origin, ...(space ? { "x-robots-space-id": space } : {}) },
    data: { json },
  });
}

async function signup(page: Page) {
  const user = account();
  await signupThroughForm(page, user.email, user.password, "Test account");
  await expect(page).toHaveURL(/\/(onboarding|app)/);
  return user;
}

test("free download, local account creation and a fresh sign-in", async ({
  page,
  browser,
}, info) => {
  await page.goto(setup);
  await expect(page.getByRole("heading", { name: "Choose your setup" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("setup.png") });
  await page.getByRole("link", { name: "Set up locally" }).click();
  const archive = await page
    .getByRole("link", { name: "Download the local installer" })
    .getAttribute("href");
  const download = await page.request.head(`${hosted}${archive}`);
  expect(download.status()).toBe(200);
  expect(Number(download.headers()["content-length"])).toBeGreaterThan(1000000);
  const localContext = await browser.newContext({ baseURL: local });
  try {
    const user = await signup(await localContext.newPage());
    expect((await (await rpc(localContext.request, local, "me")).json()).json.billingEnabled).toBe(
      false,
    );
    await localContext.clearCookies();
    const signIn = await localContext.request.post(`${local}/api/auth/sign-in/email`, {
      headers: { origin: local },
      data: user,
    });
    expect(signIn.status()).toBe(200);
    expect((await rpc(localContext.request, local, "bots/list")).status()).toBe(200);
  } finally {
    await localContext.close();
  }
});

test("hosted checkout, cancellation, retry, return and workspace isolation", async ({
  page,
  browser,
}, info) => {
  await page.goto(setup);
  await page.getByRole("link", { name: "Create a hosted account" }).click();
  await expect(page).toHaveURL(`${hosted}/sign-up`);
  const owner = await signup(page);
  const subscribe = page.getByRole("button", { name: "Subscribe", exact: true });
  await expect(subscribe).toBeVisible();
  const before = (await (await rpc(page.request, hosted, "billing/status")).json()).json;
  expect(before).toMatchObject({
    access: false,
    trialAvailable: false,
    seats: 1,
    price: { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 },
  });
  expect((await rpc(page.request, hosted, "bots/create", { name: "Unpaid" })).status()).toBe(402);
  await page.goto("/api/v1/billing/return");
  await expect(subscribe).toBeVisible();
  await subscribe.click();
  await expect(page.getByRole("heading", { name: "Test checkout" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("checkout.png") });
  const canceledUrl = page.url();
  await page.getByRole("button", { name: "Back to RoBots" }).click();
  await expect(subscribe).toBeVisible();
  expect((await page.request.get(canceledUrl)).status()).toBe(404);
  await subscribe.click();
  await expect(page.getByRole("button", { name: "Confirm test subscription" })).toBeVisible();
  const checkout = page.url();
  const second = await browser.newContext({ baseURL: hosted });
  try {
    const other = await second.newPage();
    await signup(other);
    expect((await second.request.get(checkout)).status()).toBe(404);
    expect(
      (
        await second.request.post(checkout, {
          headers: { origin: hosted },
          form: { action: "subscribe" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(checkout, {
          headers: { origin: "https://example.test" },
          form: { action: "subscribe" },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole("button", { name: "Confirm test subscription" }).click();
    await expect(page).toHaveURL(/\/(app|onboarding)/);
    const status = await rpc(page.request, hosted, "billing/status");
    expect((await status.json()).json).toMatchObject({ access: true, state: "active" });
    expect((await page.request.get(checkout)).status()).toBe(404);
    expect((await rpc(page.request, hosted, "bots/list")).status()).toBe(200);
    expect((await rpc(second.request, hosted, "bots/list")).status()).toBe(402);
    await other.getByRole("button", { name: "Subscribe", exact: true }).click();
    await other.getByRole("button", { name: "Confirm test subscription" }).click();
    await expect(other).toHaveURL(/\/(app|onboarding)/);
    expect((await rpc(second.request, hosted, "bots/list")).status()).toBe(200);
    await page.context().clearCookies();
    const signIn = await page.request.post(`${hosted}/api/auth/sign-in/email`, {
      headers: { origin: hosted },
      data: owner,
    });
    expect(signIn.status()).toBe(200);
    expect((await (await rpc(page.request, hosted, "billing/status")).json()).json.access).toBe(
      true,
    );
    const mySpace = (await (await rpc(page.request, hosted, "me")).json()).json.spaceId;
    const theirSpace = (await (await rpc(second.request, hosted, "me")).json()).json.spaceId;
    expect(mySpace).not.toBe(theirSpace);
    expect([401, 403, 404]).toContain(
      (await rpc(page.request, hosted, "bots/list", {}, theirSpace)).status(),
    );
    expect([401, 403, 404]).toContain(
      (await rpc(second.request, hosted, "bots/list", {}, mySpace)).status(),
    );
    const portal = (await (await rpc(page.request, hosted, "billing/portal")).json()).json.url;
    await page.goto(portal);
    await page.getByRole("button", { name: "End test subscription" }).click();
    await expect(subscribe).toBeVisible();
    expect((await rpc(page.request, hosted, "bots/list")).status()).toBe(402);
  } finally {
    await second.close();
  }
});
