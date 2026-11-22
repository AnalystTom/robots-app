import type { RobotLook } from "@robots/contracts";
import { parseBotAvatarValue, robotCharacterValue } from "@robots/contracts";

export const ROBOT_PRESETS = [
  {
    id: "assistant",
    look: { colour: "green", headwear: "antenna", face: "happy", outfit: "vest", extra: "none" },
  },
  {
    id: "researcher",
    look: {
      colour: "blue",
      headwear: "deerstalker",
      face: "magnifier",
      outfit: "tweed",
      extra: "none",
    },
  },
  {
    id: "coder",
    look: { colour: "teal", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  },
  {
    id: "writer",
    look: {
      colour: "purple",
      headwear: "mortarboard",
      face: "glasses",
      outfit: "turtleneck",
      extra: "none",
    },
  },
  {
    id: "analyst",
    look: {
      colour: "slate",
      headwear: "top-hat",
      face: "monocle",
      outfit: "tuxedo",
      extra: "none",
    },
  },
  {
    id: "creator",
    look: {
      colour: "pink",
      headwear: "antenna",
      face: "hearts",
      outfit: "t-shirt",
      extra: "ring-light",
    },
  },
  {
    id: "chef",
    look: {
      colour: "orange",
      headwear: "chef-hat",
      face: "happy",
      outfit: "chef-jacket",
      extra: "steam",
    },
  },
  {
    id: "hero",
    look: {
      colour: "red",
      headwear: "antenna",
      face: "aviators",
      outfit: "cape",
      extra: "confetti",
    },
  },
  {
    id: "hoodie",
    look: { colour: "green", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  },
  {
    id: "critic",
    look: {
      colour: "red",
      headwear: "chef-hat",
      face: "grumpy",
      outfit: "chef-jacket",
      extra: "steam",
    },
  },
  {
    id: "professor",
    look: {
      colour: "teal",
      headwear: "mortarboard",
      face: "monocle",
      outfit: "tweed",
      extra: "none",
    },
  },
  {
    id: "detective",
    look: {
      colour: "purple",
      headwear: "deerstalker",
      face: "magnifier",
      outfit: "cape",
      extra: "none",
    },
  },
  {
    id: "keynote",
    look: {
      colour: "slate",
      headwear: "antenna",
      face: "glasses",
      outfit: "turtleneck",
      extra: "none",
    },
  },
  {
    id: "hustler",
    look: {
      colour: "orange",
      headwear: "antenna",
      face: "aviators",
      outfit: "vest",
      extra: "none",
    },
  },
  {
    id: "host",
    look: {
      colour: "blue",
      headwear: "top-hat",
      face: "happy",
      outfit: "tuxedo",
      extra: "confetti",
    },
  },
] as const satisfies ReadonlyArray<{ id: string; look: RobotLook }>;

export type RobotPresetId = (typeof ROBOT_PRESETS)[number]["id"];

export function robotPresetValue(id: RobotPresetId): string {
  const preset = ROBOT_PRESETS.find((candidate) => candidate.id === id) ?? ROBOT_PRESETS[0];
  return robotCharacterValue(preset.look);
}

export const ROBOT_PRESET_IDS: readonly RobotPresetId[] = ROBOT_PRESETS.map((preset) => preset.id);

export function wornRobotPresetIds(wornColors: readonly string[]): RobotPresetId[] {
  return wornColors.flatMap((color) => {
    const avatar = parseBotAvatarValue(color);
    const id = avatar.kind === "robot" ? robotPresetOf(avatar.look) : null;
    return id ? [id] : [];
  });
}

export function robotPresetOf(look: RobotLook): RobotPresetId | null {
  const value = robotCharacterValue(look);
  return ROBOT_PRESETS.find((preset) => robotCharacterValue(preset.look) === value)?.id ?? null;
}
