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
  ])("drops the host assistant attribution from %j", (description, expected) => {
    expect(neutralPluginDescription(description, "example")).toBe(expected);
  });

  it.each([
    "Connect your Grok account to query logs.",
    "Tools for Grok development",
    "Give Grok a real browser. Grok keeps that authorization.",
    "Ask Grok for a weekly restock.",
    "Let Grok Bot reach MCP servers, and Grok Bot's privacy mode still applies.",
    "Groks your logs and moves the cursor to the Grok Studio API.",
  ])("keeps other mentions of the word in %j", (description) => {
    expect(neutralPluginDescription(description, "example")).toBe(description);
  });

  it("keeps the name in a plugin that is about that product", () => {
    const description = "Launch campaigns from Grok.";
    expect(neutralPluginDescription(description, "grok-voice")).toBe(description);
  });
});
