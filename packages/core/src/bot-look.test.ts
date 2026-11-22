import { isBotAvatarValue } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { ORGANIC_AVATAR_HEART_FAMILY, organicAvatarFamily } from "./avatar-shape.js";
import { DEFAULT_BOT_AVATAR_COLOR } from "./bot-avatar-colors.js";
import {
  botLookState,
  botLookWithColor,
  botLookWithShape,
  newBotLook,
  newBotLookColor,
  newBotLookForSet,
  newBotLookInput,
  newBotPreviewIdentity,
} from "./bot-look.js";
import { ROBOT_PRESETS, robotPresetValue } from "./robot-presets.js";

describe("newBotLook", () => {
  it("reserves a valid id that never draws the heart body", () => {
    for (let index = 0; index < 50; index++) {
      const look = newBotLook(index % 2 ? "robots" : "organic");
      expect(look.id).toMatch(/^c[a-z0-9]{24}$/);
      expect(organicAvatarFamily(look.id)).not.toBe(ORGANIC_AVATAR_HEART_FAMILY);
    }
  });

  it("starts a RoBots account with no picked look, so creation sends no colour", () => {
    const look = newBotLook("robots");
    expect(look.color).toBeNull();
    expect(newBotLookColor(look)).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(newBotLookInput("robots", look)).toEqual({ id: look.id });
  });

  it("starts an Original account on its own body", () => {
    const look = newBotLook("organic");
    expect(isBotAvatarValue(look.color)).toBe(true);
    expect(botLookState(look.color).defaultLook).toBe(true);
    expect(newBotLookInput("organic", look)).toEqual({
      color: look.color,
      avatarFamily: organicAvatarFamily(look.identity),
    });
  });

  it("moves a look to the account's set once it is known", () => {
    const robotLook = newBotLook("robots");
    const organic = newBotLookForSet(robotLook, "organic", []);
    expect(botLookState(organic.color!).defaultLook).toBe(true);
    const shaped = { ...organic, color: "#2A92FE::shape_2" };
    expect(newBotLookForSet(shaped, "organic", [])).toBe(shaped);
    const robotic = { ...organic, color: "robot:red.antenna.aviators.cape.confetti" };
    expect(newBotLookForSet(robotic, "robots", [])).toBe(robotic);
    expect(botLookState(newBotLookForSet(robotic, "organic", []).color!).robot).toBeNull();
  });

  it("pre-selects the listed robot the user's own bots wear least", () => {
    const everyRobotButHero = ROBOT_PRESETS.filter((preset) => preset.id !== "hero").map((preset) =>
      robotPresetValue(preset.id),
    );
    const look = newBotLookForSet(newBotLook("robots"), "robots", everyRobotButHero);
    expect(look.color).toBe("robot:red.antenna.aviators.cape.confetti");
    expect(newBotLookInput("robots", look)).toEqual({
      color: "robot:red.antenna.aviators.cape.confetti",
      id: look.id,
      avatarSet: "robots",
    });
  });

  it("sends a picked robot with the RoBots set", () => {
    const look = {
      id: "c".padEnd(25, "a"),
      color: "robot:red.antenna.aviators.cape.confetti",
      identity: "look-3-0",
    };
    expect(newBotLookInput("organic", look)).toEqual({
      color: "robot:red.antenna.aviators.cape.confetti",
      id: look.id,
      avatarSet: "robots",
    });
  });

  it("keeps the preview's look through creation", () => {
    const look = { id: "c".padEnd(25, "a"), color: "#2A92FE", identity: "look-3-0" };
    expect(newBotPreviewIdentity("robots", look)).toBe(look.id);
    expect(newBotLookInput("robots", look)).toEqual({ color: look.color, id: look.id });
    expect(newBotPreviewIdentity("organic", look)).toBe(look.identity);
    expect(newBotLookInput("organic", look)).toEqual({
      color: look.color,
      avatarFamily: organicAvatarFamily(look.identity),
    });
    const shaped = { ...look, color: "#2A92FE::shape_2" };
    expect(newBotLookInput("organic", shaped)).toEqual({ color: shaped.color });
    expect(newBotLookInput("robots", shaped)).toEqual({ color: look.color, id: look.id });
  });
});

describe("botLookState", () => {
  it("keeps the shape when the color changes and the color when the shape changes", () => {
    expect(botLookWithColor("#00C972::shape_3", "#FF781C")).toBe("#FF781C::shape_3");
    expect(botLookWithColor("#00C972", "#FF781C")).toBe("#FF781C");
    expect(botLookState(botLookWithShape("#FF781C", 5))).toEqual({
      photo: false,
      shapeIndex: 5,
      color: "#FF781C",
      robot: null,
      defaultLook: false,
    });
  });

  it("reads a robot character's parts and backdrop", () => {
    expect(botLookState("robot:teal.mortarboard.monocle.tweed.none")).toEqual({
      photo: false,
      shapeIndex: null,
      color: "#2C7672",
      robot: {
        colour: "teal",
        headwear: "mortarboard",
        face: "monocle",
        outfit: "tweed",
        extra: "none",
      },
      defaultLook: false,
    });
  });

  it("selects a color saved as its earlier value", () => {
    expect(botLookState("#8B5CF6").color).toBe("#A97EFE");
  });

  it("replaces a photo with a plain color", () => {
    const photo = "data:image/webp;base64,AAAA";
    expect(botLookState(photo)).toEqual({
      photo: true,
      shapeIndex: null,
      color: DEFAULT_BOT_AVATAR_COLOR,
      robot: null,
      defaultLook: false,
    });
    expect(botLookWithColor(photo, "#2A92FE")).toBe("#2A92FE");
  });
});
