import { expect, test } from "@playwright/test";
import { captureScreenshot, openEmailSignIn } from "./helpers";

const stripeTest = process.env.E2E_STRIPE_TEST === "1";

async function signUpFromAppEntry(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
) {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-up\?next=%2Fapp$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await openEmailSignIn(page);
  await captureScreenshot(page, testInfo, "01-app-entry-sign-up");
  await page.getByPlaceholder("Your name").fill("Demo Customer");
  await page.getByPlaceholder("Your email address").fill(`entry-${Date.now()}@robots.test`);
  await page.getByPlaceholder("Password").fill("password12");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("a first-time visitor of the app entry signs up instead of signing in", async ({
  page,
}, testInfo) => {
  await signUpFromAppEntry(page, testInfo);
  await page.waitForURL(/\/(onboarding|app)/);
});

test("a returning visitor of the app entry signs in", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("robots.signed-in-before", "1"));
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
});

test("sign up, pick the monthly plan, pay with a Stripe test card, land in the workspace", async ({
  page,
}, testInfo) => {
  test.skip(
    !stripeTest,
    "Needs the stack started with Stripe test-mode keys; set E2E_STRIPE_TEST=1",
  );
  test.setTimeout(240_000);
  await signUpFromAppEntry(page, testInfo);
  await expect(page.getByRole("heading", { name: "Choose how to use RoBots" })).toBeVisible();
  await captureScreenshot(page, testInfo, "02-plan-choice");
  const plan = page.getByRole("combobox", { name: "Monthly credits" });
  await plan.click();
  await page.getByRole("option", { name: "$20 / month" }).click();
  await captureScreenshot(page, testInfo, "03-plan-20-per-month");
  await page.getByRole("button", { name: "Subscribe to credits", exact: true }).click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  const stripeField = (placeholder: string) =>
    page
      .frameLocator("iframe")
      .first()
      .getByPlaceholder(placeholder)
      .or(page.getByPlaceholder(placeholder));
  const card = stripeField("Card number");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await captureScreenshot(page, testInfo, "04-stripe-checkout");
  await card.fill("4242424242424242");
  await stripeField("MM / YY").fill("12 / 34");
  await stripeField("Security code").fill("123");
  await stripeField("First and last name").fill("Demo Customer");
  const postcode = stripeField("Postcode");
  if (await postcode.isVisible().catch(() => false)) await postcode.fill("SW1A 1AA");
  await captureScreenshot(page, testInfo, "05-stripe-test-card");
  await page
    .frameLocator('iframe[src*="elements-inner"]')
    .first()
    .getByTestId("payment-form-submit-button")
    .click();

  await page.waitForURL(/\/(app|onboarding)/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Welcome to RoBots" })).toBeVisible();
  await captureScreenshot(page, testInfo, "06-welcome-after-payment");
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Chief").first()).toBeVisible({ timeout: 60_000 });
  await captureScreenshot(page, testInfo, "07-workspace-ready");
});
