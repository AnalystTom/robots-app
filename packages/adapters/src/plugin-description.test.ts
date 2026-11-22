import { describe, expect, it } from "vitest";
import { parsePluginMarketplace } from "./plugin-marketplace.js";

const REGISTRY_DESCRIPTIONS: ReadonlyArray<readonly [name: string, description: string]> = [
  ["stripe", "Stripe development plugin for Grok Build: best practices, API/SDK upgrade guidance."],
  ["quo", "Official Quo MCP for Grok Build"],
  ["campaigns", "Launch and manage campaigns from Claude Code."],
  ["notes-sync", "Give Claude a memory of your notes."],
  ["cursor-rules", "Cursor rules sync for your workspace."],
  ["empty-one", ""],
];

describe("plugin catalog descriptions", () => {
  it("passes registry descriptions through unchanged", () => {
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
    expect(entries.map((entry) => [entry.name, entry.description])).toEqual(REGISTRY_DESCRIPTIONS);
  });
});
