export const ROBOT_PARTS = {
  colour: ["green", "red", "teal", "purple", "slate", "pink", "orange", "blue"],
  headwear: ["antenna", "hood", "chef-hat", "mortarboard", "deerstalker", "top-hat"],
  face: ["terminal", "grumpy", "monocle", "magnifier", "glasses", "hearts", "aviators", "happy"],
  outfit: ["hoodie", "chef-jacket", "tweed", "cape", "turtleneck", "t-shirt", "vest", "tuxedo"],
  extra: ["none", "ring-light", "confetti", "steam"],
} as const;

export type RobotSlot = keyof typeof ROBOT_PARTS;
export type RobotLook = { [Slot in RobotSlot]: (typeof ROBOT_PARTS)[Slot][number] };
export type RobotColour = RobotLook["colour"];

export const ROBOT_SLOTS: readonly RobotSlot[] = ["colour", "headwear", "face", "outfit", "extra"];

export const ROBOT_CHARACTER_PREFIX = "robot:";

export const ROBOT_COLOUR_FILLS: Readonly<Record<RobotColour, string>> = {
  green: "#2F8A5B",
  red: "#D9483B",
  teal: "#2C7672",
  purple: "#6D54B5",
  slate: "#4B5563",
  pink: "#D9467F",
  orange: "#E8962B",
  blue: "#3457C9",
};

export function parseRobotCharacter(raw: string): RobotLook | null {
  if (!raw.startsWith(ROBOT_CHARACTER_PREFIX)) return null;
  const ids = raw.slice(ROBOT_CHARACTER_PREFIX.length).split(".");
  if (ids.length !== ROBOT_SLOTS.length) return null;
  const look: Partial<Record<RobotSlot, string>> = {};
  for (const [index, slot] of ROBOT_SLOTS.entries()) {
    const id = ids[index]!;
    if (!(ROBOT_PARTS[slot] as readonly string[]).includes(id)) return null;
    look[slot] = id;
  }
  return look as RobotLook;
}

export function robotCharacterValue(look: RobotLook): string {
  return `${ROBOT_CHARACTER_PREFIX}${ROBOT_SLOTS.map((slot) => look[slot]).join(".")}`;
}
