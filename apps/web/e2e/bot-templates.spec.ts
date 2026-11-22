import { expect, test } from "@playwright/test";
import type { Bot, BotTemplateListing, Routine } from "@robots/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("the template gallery creates a ready-made bot in one tap, wearing its robot", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `templates-${Date.now()}@robots.test`, "password12", "Template Test");
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Integrations", exact: true })
    .getByTestId("open-bot-templates")
    .click();
  const dialog = page.getByRole("dialog", { name: "RoBot templates", exact: true });
  const cards = dialog.getByTestId("bot-template-card");
  await expect(cards).toHaveCount(14);
  await expect(cards.locator("h3")).toHaveText([
    "Chief of Staff",
    "Dev",
    "Researcher",
    "Sales",
    "GTM",
    "Refund Bot",
    "Inbox triage",
    "Morning briefing",
    "Meeting prep",
    "PR reviewer",
    "Issue triage",
    "Release notes",
    "Weekly recap",
    "Topic watch",
  ]);
  await expect(dialog.getByText("Needs you", { exact: true })).toHaveCount(0);

  const team = dialog.getByTestId("bot-template-team");
  await expect(team).toContainText("Autopilot team");
  await expect(team.locator(".robots-bot-avatar-picture img")).toHaveCount(6);
  await expect(
    team.getByRole("button", { name: "Create Autopilot team", exact: true }),
  ).toBeVisible();

  const triage = cards.filter({ hasText: "Inbox triage" });
  await expect(triage).toContainText("Sorts new email and drafts the replies");
  await expect(triage.getByRole("listitem", { name: "Gmail", exact: true })).toBeVisible();
  const cardRobot = triage.locator(".robots-bot-avatar-picture img");
  await expect(cardRobot).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  const robotSrc = await cardRobot.getAttribute("src");
  await expect(
    cards.filter({ hasText: "GTM" }).getByRole("listitem", { name: "Launchpost" }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "bot-templates");

  await triage.getByRole("button", { name: "Create Inbox triage", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/[^/?]+/);
  const botId = activeBotId(page);

  const templates = await rpc<BotTemplateListing[]>(page, "bots/templates", {});
  const template = templates.find((item) => item.id === "inbox-triage")!;
  const bot = await rpc<Bot>(page, "bots/get", { botId });
  expect([bot.name, bot.description, bot.color]).toEqual([
    "Inbox triage",
    "Email triage",
    template.avatar,
  ]);
  expect(template.botId).toBe(botId);
  const routines = await rpc<Routine[]>(page, "routines/list", { botId });
  expect(routines.map((routine) => [routine.name, routine.active])).toEqual([
    ["Inbox triage", false],
  ]);

  await expect(page.getByRole("group", { name: "Gmail connection", exact: true })).toBeVisible();
  await expect(page.getByTestId("import-setup-card")).toContainText("Inbox triage");
  await expect(page.locator(`img[src="${robotSrc}"]`).first()).toBeVisible();
  await captureScreenshot(page, testInfo, "bot-template-created");

  await page.goto(`/app/${botId}?templates`);
  await expect(
    cards
      .filter({ hasText: "Inbox triage" })
      .getByRole("button", { name: "Open Inbox triage", exact: true }),
  ).toBeVisible();
});

test("a team that stops short keeps its bots, and Retry finishes it without duplicates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `template-team-${Date.now()}@robots.test`, "password12", "Team Test");
  await completeOnboarding(page);

  const templates = await rpc<BotTemplateListing[]>(page, "bots/templates", {});
  const names = (id: string) => templates.find((item) => item.id === id)!.name;
  const salesName = names("sales");

  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Integrations", exact: true })
    .getByTestId("open-bot-templates")
    .click();
  const dialog = page.getByRole("dialog", { name: "RoBot templates", exact: true });
  await expect(dialog.getByTestId("bot-template-team")).toBeVisible();

  let teamCalls = 0;
  await page.route("**/rpc/bots/createTeamFromTemplate", async (route) => {
    teamCalls += 1;
    if (teamCalls > 1) return route.continue();
    const response = await route.fetch();
    const { json: real } = (await response.json()) as {
      json: { bots: Bot[]; failed: string[] };
    };
    const sales = real.bots.find((bot) => bot.name === salesName)!;
    await rpc(page, "bots/archive", { botId: sales.id });
    await route.fulfill({
      response,
      json: {
        json: {
          bots: real.bots.filter((bot) => bot.id !== sales.id),
          failed: ["sales"],
        },
      },
    });
  });
  await dialog
    .getByTestId("bot-template-team")
    .getByRole("button", { name: "Create Autopilot team", exact: true })
    .click();
  await expect(
    dialog.getByText("Created 5 of 6 bots. Try again to finish the team.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(teamCalls).toBe(2);

  const bots = await rpc<Bot[]>(page, "bots/list", {});
  const lead = bots.find((bot) => bot.name === names("chief-of-staff"))!;
  await expect(page).toHaveURL(new RegExp(`/app/${lead.id}`));
  for (const id of ["chief-of-staff", "developer", "researcher", "sales", "gtm", "refund-bot"]) {
    expect(bots.filter((bot) => bot.name === names(id))).toHaveLength(1);
  }
});
