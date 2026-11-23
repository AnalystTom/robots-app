import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("Launchpost is listed in Connect apps and opens to a one-click Connect", async ({
  page,
}, testInfo) => {
  await signup(page, `launchpost-${Date.now()}@robots.test`, "password12", "Launchpost");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true });
  const row = dialog.getByTestId("remote-mcp-apps").getByTestId("plugin-row");
  await expect(row).toContainText("Launchpost");
  await expect(row).toContainText("Schedule and publish social posts.");
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
