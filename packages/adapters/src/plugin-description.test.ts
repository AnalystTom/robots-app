import { describe, expect, it } from "vitest";
import { neutralPluginDescription } from "./plugin-description.js";

describe("neutralPluginDescription", () => {
  it.each([
    [
      "Stripe development plugin for Grok Build: best practices, API/SDK upgrade guidance.",
      "Stripe development plugin: best practices, API/SDK upgrade guidance.",
    ],
    ["Official Quo MCP for Grok Build", "Official Quo MCP"],
    ["Query logs and investigate issues directly from Grok.", "Query logs and investigate issues."],
    [
      "Connect with OAuth to access current web information directly from Grok Build",
      "Connect with OAuth to access current web information",
    ],
    ["Launch and manage campaigns from Grok.", "Launch and manage campaigns."],
    ["You can disconnect the store anytime from grok.", "You can disconnect the store anytime."],
    [
      "Give Grok a real browser. Grok keeps that authorization.",
      "Give your bot a real browser. Your bot keeps that authorization.",
    ],
    [
      "Let Grok Bot reach MCP servers, and Grok Bot's privacy mode still applies.",
      "Let your bot reach MCP servers, and your bot's privacy mode still applies.",
    ],
    ["Ask Grok for a weekly restock.", "Ask your bot for a weekly restock."],
  ])("drops the host assistant's name from %j", (description, expected) => {
    expect(neutralPluginDescription(description, "example")).toBe(expected);
  });

  it("keeps other products and words untouched", () => {
    const description = "Groks your logs and moves the cursor to the Grok Studio API.";
    expect(neutralPluginDescription(description, "example")).toBe(description);
  });

  it("keeps the name in a plugin that is about that product", () => {
    const description = "Add Grok voice to an app.";
    expect(neutralPluginDescription(description, "grok-voice")).toBe(description);
  });
});
