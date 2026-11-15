import { describe, expect, it } from "vitest";
import {
  BotAvatarValueSchema,
  CreateBotInput,
  isBotAvatarValue,
  parseBotAvatarValue,
  parseRobotCharacter,
  ROBOT_PARTS,
  robotCharacterValue,
} from "./index.js";

const VALUE = "robot:blue.antenna.happy.t-shirt.none";

describe("robot character values", () => {
  it("parses a value built from known parts and takes its colour's backdrop", () => {
    expect(parseBotAvatarValue(VALUE)).toEqual({
      kind: "robot",
      look: {
        colour: "blue",
        headwear: "antenna",
        face: "happy",
        outfit: "t-shirt",
        extra: "none",
      },
      color: "#3457C9",
    });
    expect(isBotAvatarValue(VALUE)).toBe(true);
    expect(BotAvatarValueSchema.safeParse(VALUE).success).toBe(true);
    expect(CreateBotInput.safeParse({ name: "Bot", color: VALUE }).success).toBe(true);
  });

  it("round-trips every part", () => {
    for (const colour of ROBOT_PARTS.colour)
      for (const headwear of ROBOT_PARTS.headwear)
        for (const face of ROBOT_PARTS.face) {
          const look = { colour, headwear, face, outfit: "vest", extra: "confetti" } as const;
          expect(parseRobotCharacter(robotCharacterValue(look))).toEqual(look);
        }
  });

  it.each([
    "robot:blue.antenna.happy.t-shirt",
    "robot:blue.antenna.happy.t-shirt.none.none",
    "robot:cyan.antenna.happy.t-shirt.none",
    "robot:blue.crown.happy.t-shirt.none",
    "robot:Blue.antenna.happy.t-shirt.none",
    "robot:blue.antenna.happy.t-shirt.none ",
    "robot:blue.<script>alert(1)</script>.happy.t-shirt.none",
    'robot:blue.antenna"/><script>.happy.t-shirt.none',
    "robot:blue.antenna.happy.t-shirt.none::shape_1",
    "robot:",
    "robot:....",
    "robot:blue.antenna.happy.__proto__.none",
  ])("rejects %s", (value) => {
    expect(parseRobotCharacter(value)).toBeNull();
    expect(isBotAvatarValue(value)).toBe(false);
    expect(BotAvatarValueSchema.safeParse(value).success).toBe(false);
    expect(parseBotAvatarValue(value).kind).not.toBe("robot");
  });
});
