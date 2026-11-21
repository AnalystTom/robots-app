import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "./helpers";

test("an app's page shows access and tools, and its permission dialog turns sending off", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `connection-page-${Date.now()}@robots.test`, "password12", "Sample");
  await completeOnboarding(page);
  await page.goto(`/app/${activeBotId(page)}?integrations=`);
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true });

  const calendar = dialog.getByRole("button", { name: /Google Calendar$/ }).first();
  await calendar.click();
  const calendarPage = page.getByTestId("connection-page");
  await expect(calendarPage.getByText("Always on", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("connection-accounts").getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("connection-tools")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "connection-page-not-connected");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const gmailRow = dialog
    .getByText("Gmail", { exact: true })
    .first()
    .locator("xpath=ancestor::*[count(.//button)>=2][1]");
  await gmailRow.getByRole("button", { name: "Add", exact: true }).click();
  await gmailRow.getByRole("button", { name: "Added", exact: true }).click();
  const tools = page.getByTestId("connection-tools");
  const send = page.getByRole("button", { name: "Permission for Send email", exact: true });
  await expect(send).toHaveText("Ask each time");
  await expect(tools.getByText("Chief asks before each email", { exact: false })).toBeVisible();
  await captureScreenshot(page, testInfo, "connection-page-connected");

  await tools
    .getByTestId("tool-row-risky")
    .filter({ hasText: "Send email" })
    .getByRole("button", { name: "Send email", exact: true })
    .click();
  const permission = page.getByTestId("permission-dialog");
  await expect(permission.getByText("Allow Chief to send email", { exact: true })).toBeVisible();
  const toggle = permission.getByRole("switch", { name: "Allow Send email" });
  await expect(toggle).toBeChecked();
  await captureScreenshot(page, testInfo, "connection-permission-dialog");
  const saved = page.waitForResponse(
    (response) => response.url().includes("actionRules/set") && response.ok(),
  );
  await toggle.click();
  await saved;
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(send).toHaveText("Off");

  await page.getByRole("button", { name: "Close integrations", exact: true }).click();
  const settings = await openUserSettings(page);
  await settings.getByTestId("settings-nav-confirmations").click();
  await expect(settings.getByTestId("action-rule")).toContainText("Gmail send email");
  await captureScreenshot(page, testInfo, "connection-permission-rule");
});
