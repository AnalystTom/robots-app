import { BotTemplateSchema, parseRobotCharacter } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { looksLikeCredential } from "./agent-import/index.js";
import { buildSkillMd, extractRoutineSkillMentions } from "./agent-skill.js";
import { BOT_TEMPLATES, botTemplateAppMarks, findBotTemplate } from "./bot-templates.js";
import { presetFromCron } from "./cron.js";
import { matchFeaturedConnectorId } from "./featured-connectors.js";
import { REMOTE_MCP_APPS } from "./remote-mcp-apps.js";
import { ROBOT_PRESETS, robotPresetValue } from "./robot-character.js";
import { scanSkillSafety } from "./skill-safety.js";

describe("bot templates", () => {
  it("each validates strictly and has a unique id", () => {
    for (const template of BOT_TEMPLATES) {
      expect(BotTemplateSchema.parse(template)).toEqual(template);
    }
    const ids = BOT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findBotTemplate("morning-briefing")?.name).toBe("Morning briefing");
    expect(findBotTemplate("missing")).toBeUndefined();
  });

  it("carry nothing shaped like a credential", () => {
    for (const template of BOT_TEMPLATES) {
      const texts = [
        template.instructions,
        ...template.skills.flatMap((skill) => [skill.description, skill.body]),
        ...template.routines.map((routine) => routine.prompt),
      ];
      expect(texts.filter(looksLikeCredential)).toEqual([]);
    }
  });

  it("mention only their own skills, and every skill is used by a routine", () => {
    for (const template of BOT_TEMPLATES) {
      const names = template.skills.map((skill) => skill.name);
      const mentioned = template.routines.flatMap((routine) =>
        extractRoutineSkillMentions(routine.prompt),
      );
      expect(new Set(mentioned)).toEqual(new Set(names));
    }
  });

  it("use schedules the routine editor shows without Advanced", () => {
    for (const template of BOT_TEMPLATES) {
      for (const cron of template.routines.flatMap((routine) => routine.crons)) {
        expect(presetFromCron(cron).freq).not.toBe("Advanced");
      }
    }
  });

  it("name apps the connection catalog or the remote apps list knows", () => {
    for (const app of BOT_TEMPLATES.flatMap((template) => template.apps)) {
      const known =
        app === "github" ||
        matchFeaturedConnectorId(app) !== null ||
        REMOTE_MCP_APPS.some((remote) => remote.id === app);
      expect(known, app).toBe(true);
    }
  });

  it("wear a different ready-made robot each", () => {
    const presets = new Set(ROBOT_PRESETS.map((preset) => robotPresetValue(preset.id)));
    const avatars = BOT_TEMPLATES.map((template) => template.avatar);
    expect(avatars.filter((avatar) => !presets.has(avatar))).toEqual([]);
    expect(new Set(avatars).size).toBe(avatars.length);
    expect(parseRobotCharacter(findBotTemplate("pr-reviewer")!.avatar)).toMatchObject({
      headwear: "chef-hat",
      outfit: "chef-jacket",
    });
  });

  it("offers a useful range of bots", () => {
    expect(BOT_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(BOT_TEMPLATES.length).toBeLessThanOrEqual(12);
    expect(BOT_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining([
        "inbox-triage",
        "morning-briefing",
        "pr-reviewer",
        "topic-watch",
        "social-poster",
      ]),
    );
  });

  it("marks catalog apps from the catalog and remote apps by their site", () => {
    const gmail = {
      connectorId: "apps",
      slug: "gmail",
      name: "Gmail",
      logo: "https://logos.example/gmail.svg",
      connected: false,
    } as Parameters<typeof botTemplateAppMarks>[1][number];
    expect(botTemplateAppMarks({ apps: ["gmail", "launchpost", "unknown"] }, [gmail])).toEqual([
      { key: "apps:gmail", name: "Gmail", logo: "https://logos.example/gmail.svg", site: null },
      { key: "launchpost", name: "Launchpost", logo: null, site: "https://launchpost.app" },
    ]);
  });

  it("has skills the safety check passes", () => {
    for (const template of BOT_TEMPLATES) {
      for (const skill of template.skills) {
        expect(scanSkillSafety(buildSkillMd(skill)), `${template.id}/${skill.name}`).toEqual([]);
      }
    }
  });
});
