import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openNewBot,
  openUserSettings,
  rpc,
  signup,
} from "./helpers";

test("bot style stays available when bootstrap omits the saved preference", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.json.me.botAvatarSet;
    await route.fulfill({ response, json: body });
  });
  await signup(page, `bot-style-${Date.now()}@robots.test`, "password12", "Tester");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  const picker = settings.getByTestId("bot-style-select");
  const original = picker.getByRole("button", { name: "Original", exact: true });
  const robots = picker.getByRole("button", { name: "RoBots", exact: true });
  await expect(original).toBeVisible();
  await expect(original).toHaveAttribute("aria-pressed", "false");
  await robots.click();
  await expect(robots).toHaveAttribute("aria-pressed", "true");
  await original.click();
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await captureScreenshot(page, testInfo, "bot-style-original");
  await page.unroute("**/rpc/bootstrap");
  await page.reload();
  await openUserSettings(page);
  await expect(
    page.getByTestId("bot-style-select").getByRole("button", { name: "Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

const ROBOT_CHARACTERS = [
  "Assistant",
  "Researcher",
  "Coder",
  "Writer",
  "Analyst",
  "Creator",
  "Chef",
  "Hero",
  "Professor",
  "Detective",
  "Keynote",
  "Hustler",
  "Host",
  "Critic",
  "Hoodie",
];

test("a new account picks from the robot characters and an Original account keeps Original", async ({
  page,
}, testInfo) => {
  await signup(page, `bot-style-default-${Date.now()}@robots.test`, "password12", "Tester");
  await completeOnboarding(page);
  expect((await rpc<{ botAvatarSet?: string }>(page, "me", {})).botAvatarSet).toBe("robots");
  const chief = await rpc<{ color: string }>(page, "bots/get", { botId: activeBotId(page) });
  expect(chief.color).toMatch(/^robot:/);

  await openNewBot(page);
  const dialog = page.getByTestId("create-bot-dialog");
  const characters = dialog.getByRole("radiogroup", { name: "Character" });
  await expect(characters.getByRole("radio")).toHaveCount(ROBOT_CHARACTERS.length);
  for (const name of ROBOT_CHARACTERS) {
    await expect(characters.getByRole("radio", { name, exact: true })).toBeVisible();
  }
  await expect(dialog.locator(".robots-logo-avatar")).toHaveCount(0);
  await expect(dialog.locator(".robots-organic-avatar")).toHaveCount(0);
  const detective = characters.getByRole("radio", { name: "Detective", exact: true });
  await detective.click();
  await expect(detective).toHaveAttribute("aria-checked", "true");
  await captureScreenshot(page, testInfo, "new-bot-robot-characters");
  await dialog.getByPlaceholder("Name your Bot").fill("Sleuth");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  const bots = await rpc<{ name: string; color: string }[]>(page, "bots/list", {});
  expect(bots.find((bot) => bot.name === "Sleuth")?.color).toBe(
    "robot:purple.deerstalker.magnifier.cape.none",
  );

  await rpc(page, "preferences/update", { botAvatarSet: "organic" });
  await page.reload();
  expect((await rpc<{ botAvatarSet?: string }>(page, "me", {})).botAvatarSet).toBe("organic");
  const settings = await openUserSettings(page);
  await expect(
    settings.getByTestId("bot-style-select").getByRole("button", { name: "Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
