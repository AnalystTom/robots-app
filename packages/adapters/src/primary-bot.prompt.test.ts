import { PRIMARY_BOT_SPAWN_KEY } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { PRIMARY_BOT_OPERATING_MODEL } from "./primary-bot.prompt.js";
import { runIdentityInstruction } from "./run-instructions.prompt.js";

const primary = {
  name: "RoBot",
  description: "",
  instructions: "",
  spawnKey: PRIMARY_BOT_SPAWN_KEY,
};

describe("primary bot operating model", () => {
  it("frames every run of the primary bot, whatever the trigger", () => {
    for (const trigger of ["user", "routine", "follow_up", "bot_message", "created"]) {
      expect(runIdentityInstruction(primary, trigger)).toContain(PRIMARY_BOT_OPERATING_MODEL);
    }
  });

  it("keeps the user's edited instructions after the operating model", () => {
    const prompt = runIdentityInstruction(
      { ...primary, instructions: "Only talk about the garden." },
      "user",
    );
    expect(prompt).toBe(
      [
        "RoBot",
        PRIMARY_BOT_OPERATING_MODEL,
        "Teammates see only the profile above. These instructions are private to you:",
        "Only talk about the garden.",
      ].join("\n"),
    );
  });

  it("still applies to a primary bot created with older default instructions", () => {
    const legacy =
      "You are RoBot: the user's primary bot and the orchestrator for every other Bot in this workspace.\n- Ask before anything that sends email, publishes, spends money or can't be undone.";
    const prompt = runIdentityInstruction({ ...primary, instructions: legacy }, "routine");
    expect(prompt).toContain(PRIMARY_BOT_OPERATING_MODEL);
    expect(prompt.endsWith(legacy)).toBe(true);
  });

  it("is absent for every other bot", () => {
    const others = [
      { name: "Ada", description: "Reads mail.", instructions: "Sort it." },
      { name: "Ada", description: "Reads mail.", instructions: "Sort it.", spawnKey: null },
      {
        name: "Ada",
        description: "Reads mail.",
        instructions: "Sort it.",
        spawnKey: "tool-call-1",
      },
    ];
    for (const bot of others) {
      for (const trigger of ["user", "created"]) {
        expect(runIdentityInstruction(bot, trigger)).not.toContain(PRIMARY_BOT_OPERATING_MODEL);
      }
    }
  });

  it("stays short enough to sit in every primary bot run", () => {
    expect(PRIMARY_BOT_OPERATING_MODEL.split(/\s+/).length).toBeLessThan(360);
  });
});
