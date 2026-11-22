import { isBotAvatarValue, parseRobotCharacter } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import {
  leastWornRobotValue,
  ROBOT_PRESETS,
  robotPresetOf,
  robotPresetValue,
} from "./robot-presets.js";

const EXPECTED_ROBOTS = [
  ["assistant", "robot:green.antenna.happy.vest.none"],
  ["researcher", "robot:blue.deerstalker.magnifier.tweed.none"],
  ["coder", "robot:teal.hood.terminal.hoodie.none"],
  ["writer", "robot:purple.mortarboard.glasses.turtleneck.none"],
  ["analyst", "robot:slate.top-hat.monocle.tuxedo.none"],
  ["creator", "robot:pink.antenna.hearts.t-shirt.ring-light"],
  ["chef", "robot:orange.chef-hat.happy.chef-jacket.steam"],
  ["hero", "robot:red.antenna.aviators.cape.confetti"],
  ["hoodie", "robot:green.hood.terminal.hoodie.none"],
  ["critic", "robot:red.chef-hat.grumpy.chef-jacket.steam"],
  ["professor", "robot:teal.mortarboard.monocle.tweed.none"],
  ["detective", "robot:purple.deerstalker.magnifier.cape.none"],
  ["keynote", "robot:slate.antenna.glasses.turtleneck.none"],
  ["hustler", "robot:orange.antenna.aviators.vest.none"],
  ["host", "robot:blue.top-hat.happy.tuxedo.confetti"],
] as const;

describe("robot presets", () => {
  it("are exactly the fifteen ready-made robots, in picker order", () => {
    expect(ROBOT_PRESETS.map((preset) => [preset.id, robotPresetValue(preset.id)])).toEqual(
      EXPECTED_ROBOTS,
    );
  });

  it("are distinct, valid robots that each name their own preset", () => {
    const values = ROBOT_PRESETS.map((preset) => robotPresetValue(preset.id));
    expect(new Set(values).size).toBe(ROBOT_PRESETS.length);
    for (const preset of ROBOT_PRESETS) {
      expect(isBotAvatarValue(robotPresetValue(preset.id))).toBe(true);
      expect(robotPresetOf(preset.look)).toBe(preset.id);
    }
  });

  it("picks the listed robot the given bots wear least, ignoring other looks", () => {
    const everyRobotButHero = ROBOT_PRESETS.filter((preset) => preset.id !== "hero").map((preset) =>
      robotPresetValue(preset.id),
    );
    const worn = [...everyRobotButHero, "#8B5CF6"];
    expect(leastWornRobotValue(worn, () => 0.5)).toBe(robotPresetValue("hero"));
    expect(leastWornRobotValue([], () => 0)).toBe("robot:green.antenna.happy.vest.none");
  });

  it("do not claim a recoloured or reassembled robot", () => {
    const chef = parseRobotCharacter(robotPresetValue("chef"))!;
    expect(robotPresetOf({ ...chef, colour: "blue" })).toBeNull();
    expect(robotPresetOf({ ...chef, face: "monocle" })).toBeNull();
    expect(robotPresetOf(parseRobotCharacter("robot:teal.top-hat.hearts.cape.none")!)).toBeNull();
  });
});
