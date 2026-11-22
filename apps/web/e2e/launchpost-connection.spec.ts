import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("Launchpost is listed in Connect apps and opens to a one-click Connect", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signup(page, `launchpost-${Date.now()}@robots.test`, "password12", "Launchpost");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true });
  const available = dialog.getByTestId("featured-connectors");
  const row = available.getByTestId("plugin-row").filter({ hasText: "Launchpost" });
  await expect(row).toContainText("Schedule and publish social posts.");
  const sections = dialog.locator(
    '[data-testid="connected-integrations"], [data-testid="mac-apps"], [data-testid="featured-connectors"]',
  );
  expect(
    await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid"))),
  ).toEqual(["mac-apps", "featured-connectors"]);
  await expect(available.getByRole("heading", { level: 2 })).toHaveText("Available");
  const monogram = row.locator("div").first();
  await expect(monogram).toHaveText("L");
  const [ink, plate] = await monogram.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor];
  });
  expect(ink).not.toBe(plate);
  await captureScreenshot(page, testInfo, "launchpost-in-connect-apps");

  await row.getByRole("button", { name: "Add", exact: true }).click();
  const detail = page.getByTestId("connection-detail");
  await expect(detail.getByRole("heading", { name: "Launchpost" })).toBeVisible();
  await expect(detail.getByText("Launchpost account", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "launchpost-connection-page");

  await page.getByRole("dialog").getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("textbox", { name: "Search apps" }).fill("social posts");
  await expect(dialog.getByTestId("remote-mcp-apps")).toContainText("Launchpost");
});
