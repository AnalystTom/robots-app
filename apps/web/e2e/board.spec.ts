import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  openUserSettings,
  signup,
} from "./helpers";

test("board creates a ticket and opens it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const title = "Ship the board";
  const description = "Track the kanban launch.";
  await signup(page, `board-${stamp}@robots.test`, "password12", "Board QA");
  await completeOnboarding(page);
  await createNamedBot(page, "Planner");

  await expect(page.getByTestId("workspace-nav-tasks")).toHaveCount(0);
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = await openUserSettings(page, "labs");
  const boardLab = settings.getByTestId("lab-board-toggle");
  await expect(boardLab).not.toBeChecked();
  await boardLab.click();
  await expect(boardLab).toBeChecked();
  await expect(boardLab).toBeEnabled();
  await captureScreenshot(page, testInfo, "settings-labs");
  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings).toBeHidden();

  await page.getByTestId("workspace-nav-tasks").click();
  await expect(page).toHaveURL(/\/app\/tasks$/);
  await expect(page.getByTestId("task-columns")).toBeVisible();
  await expect(page.getByText("No tickets yet", { exact: true })).toBeVisible();
  const board = page.getByTestId("task-columns");
  expect(await board.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.getByTestId("task-column-done")).toBeInViewport();
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await captureScreenshot(page, testInfo, "board-kanban");

  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill(description);
  const owner = dialog.getByLabel("Owner");
  await expect(owner.locator("option", { hasText: "Planner" })).toHaveCount(1);
  await owner.selectOption({ label: "Planner" });
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await expect(dialog).toBeHidden();
  const card = page.locator("[data-testid^='task-card-']").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Planner");
  await captureScreenshot(page, testInfo, "board-ticket-created");

  await card.click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail.getByLabel("Title")).toHaveValue(title);
  await expect(detail.getByTestId("ticket-description")).toHaveValue(description);
  await expect(detail.getByTestId("ticket-comments")).toBeVisible();
  await captureScreenshot(page, testInfo, "board-ticket-detail");
});
