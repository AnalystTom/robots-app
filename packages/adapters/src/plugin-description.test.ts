import { describe, expect, it } from "vitest";
import { withoutHostAttribution } from "./plugin-description.js";
import { parsePluginMarketplace } from "./plugin-marketplace.js";

const REGISTRY_DESCRIPTIONS: ReadonlyArray<readonly [name: string, description: string]> = [
  ["stripe", "Stripe development plugin for Grok Build: best practices, API/SDK upgrade guidance."],
  ["supabase", "Official Supabase plugin for Grok Build with bundled Supabase MCP server."],
  ["quo", "Official Quo MCP for Grok Build"],
  ["logbook", "Query logs and investigate issues directly from Grok."],
  ["campaigns", "Launch and manage campaigns from Claude Code."],
  ["tickets", "Triage tickets in Codex, then hand them back to your team."],
  ["notes-sync", "Give Claude a memory of your notes."],
  ["empty-one", ""],
];

describe("plugin catalog descriptions", () => {
  it("strips the other agent product from catalog descriptions and passes the rest through", () => {
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
    expect(entries.map((entry) => [entry.name, entry.description])).toEqual([
      ["stripe", "Stripe development plugin: best practices, API/SDK upgrade guidance."],
      ["supabase", "Official Supabase plugin with bundled Supabase MCP server."],
      ["quo", "Official Quo MCP"],
      ["logbook", "Query logs and investigate issues."],
      ["campaigns", "Launch and manage campaigns."],
      ["tickets", "Triage tickets, then hand them back to your team."],
      ["notes-sync", "Give Claude a memory of your notes."],
      ["empty-one", ""],
    ]);
  });

  it.each([
    ["Official Quo MCP for Grok Build", "Official Quo MCP"],
    ["Query logs and investigate issues directly from Grok.", "Query logs and investigate issues."],
    ["Launch and manage campaigns from Claude Code.", "Launch and manage campaigns."],
    ["Sync tasks and projects with the Cursor IDE.", "Sync tasks and projects."],
  ])("drops the host agent attribution from %j", (description, expected) => {
    expect(withoutHostAttribution(description)).toBe(expected);
  });

  it.each([
    "Moves the cursor to the next field.",
    "Use Claude to write docs.",
    "Sends payouts with a copilot review step.",
    "Daily notes for your team.",
  ])("keeps unrelated wording in %j", (description) => {
    expect(withoutHostAttribution(description)).toBe(description);
  });
});
