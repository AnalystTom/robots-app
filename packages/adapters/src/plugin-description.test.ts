import { describe, expect, it } from "vitest";
import { namesAgentProduct, robotsPluginDescription } from "./plugin-description.js";
import { parsePluginMarketplace } from "./plugin-marketplace.js";

const REGISTRY_DESCRIPTIONS: ReadonlyArray<readonly [name: string, description: string]> = [
  ["stripe", "Stripe development plugin for Grok Build: best practices, API/SDK upgrade guidance."],
  ["supabase", "Official Supabase plugin for Grok Build with bundled Supabase MCP server."],
  ["figma", "Official Figma MCP server and skills for design-to-code workflows in Cursor."],
  ["quo", "Official Quo MCP for Grok Build"],
  ["logbook", "Query logs and investigate issues directly from Grok."],
  ["websearch", "Connect with OAuth to access current web information directly from Grok Build"],
  ["campaigns", "Launch and manage campaigns from Claude Code."],
  ["tickets", "Triage tickets in Codex, then hand them back to your team."],
  ["notes-sync", "Give Claude a memory of your notes."],
  ["browser-kit", "Tools for Cursor agents"],
  ["empty-one", ""],
];

describe("plugin catalog descriptions", () => {
  it("never shows another agent product in a catalog description", () => {
    const { entries } = parsePluginMarketplace(
      JSON.stringify({
        name: "example",
        plugins: REGISTRY_DESCRIPTIONS.map(([name, description]) => ({
          name,
          description,
          source: `./${name}`,
        })),
      }),
      { name: "Cursor", repository: "https://github.com/example/plugins" },
    );
    expect(entries).toHaveLength(REGISTRY_DESCRIPTIONS.length);
    for (const entry of entries) {
      expect(entry.description, entry.name).not.toBe("");
      expect(namesAgentProduct(entry.description), entry.description).toBe(false);
    }
  });

  it("uses RoBots copy for recommended apps", () => {
    expect(robotsPluginDescription(REGISTRY_DESCRIPTIONS[0]![1], "stripe")).toBe(
      "Look up payments, customers and subscriptions.",
    );
    expect(robotsPluginDescription(REGISTRY_DESCRIPTIONS[1]![1], "supabase")).toBe(
      "Query your database and manage your projects.",
    );
  });

  it.each([
    ["Official Quo MCP for Grok Build", "Official Quo MCP"],
    ["Query logs and investigate issues directly from Grok.", "Query logs and investigate issues."],
    ["Launch and manage campaigns from Claude Code.", "Launch and manage campaigns."],
    ["Sync tasks and projects with the Cursor IDE.", "Sync tasks and projects."],
  ])("drops the host agent attribution from %j", (description, expected) => {
    expect(robotsPluginDescription(description, "example")).toBe(expected);
  });

  it.each([
    ["Give Claude a memory of your notes.", "notes-sync"],
    ["Tools for Cursor agents", "browser-kit"],
    ["", "planning_notes"],
  ])("describes %j as what the RoBot can do instead", (description, name) => {
    expect(robotsPluginDescription(description, name)).toMatch(/^Work with .+ from your RoBot\.$/);
  });

  it.each([
    "Moves the cursor to the next field.",
    "Sends payouts with a copilot review step.",
    "Daily notes for your team.",
  ])("keeps ordinary words in %j", (description) => {
    expect(robotsPluginDescription(description, "example")).toBe(description);
  });
});
