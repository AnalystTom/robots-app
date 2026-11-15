import type { RobotLook, RobotSlot } from "@robots/contracts";
import { ROBOT_COLOUR_FILLS, ROBOT_PARTS, robotCharacterValue } from "@robots/contracts";
import { ROBOT_COLOUR_GLOWS, ROBOT_PART_ART } from "./robot-character-parts.js";

/** The ready-made robots, each a fixed set of parts. */
export const READY_MADE_ROBOTS = {
  hoodie: { colour: "green", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  chef: {
    colour: "red",
    headwear: "chef-hat",
    face: "grumpy",
    outfit: "chef-jacket",
    extra: "steam",
  },
  professor: {
    colour: "teal",
    headwear: "mortarboard",
    face: "monocle",
    outfit: "tweed",
    extra: "none",
  },
  detective: {
    colour: "purple",
    headwear: "deerstalker",
    face: "magnifier",
    outfit: "cape",
    extra: "none",
  },
  keynote: {
    colour: "slate",
    headwear: "antenna",
    face: "glasses",
    outfit: "turtleneck",
    extra: "none",
  },
  influencer: {
    colour: "pink",
    headwear: "antenna",
    face: "hearts",
    outfit: "t-shirt",
    extra: "ring-light",
  },
  hustler: {
    colour: "orange",
    headwear: "antenna",
    face: "aviators",
    outfit: "vest",
    extra: "none",
  },
  host: { colour: "blue", headwear: "top-hat", face: "happy", outfit: "tuxedo", extra: "confetti" },
} as const satisfies Record<string, RobotLook>;

export type ReadyMadeRobot = keyof typeof READY_MADE_ROBOTS;

/** What a builder starts from when the bot has no robot yet. */
export const DEFAULT_ROBOT_LOOK: RobotLook = {
  colour: "blue",
  headwear: "antenna",
  face: "happy",
  outfit: "t-shirt",
  extra: "none",
};

export function readyMadeRobotValue(key: ReadyMadeRobot): string {
  return robotCharacterValue(READY_MADE_ROBOTS[key]);
}

function pick<T>(options: readonly T[], random: () => number): T {
  return options[Math.floor(random() * options.length)] ?? options[0]!;
}

/**
 * A random robot: random headwear, face and outfit with no extra, so new bots look distinct.
 * The colour is the caller's when given.
 */
export function randomRobotLook(
  random: () => number = Math.random,
  colour: RobotLook["colour"] = pick(ROBOT_PARTS.colour, random),
): RobotLook {
  return {
    colour,
    headwear: pick(ROBOT_PARTS.headwear, random),
    face: pick(ROBOT_PARTS.face, random),
    outfit: pick(ROBOT_PARTS.outfit, random),
    extra: "none",
  };
}

export function randomRobotCharacterValue(random: () => number = Math.random): string {
  return robotCharacterValue(randomRobotLook(random));
}

/** The look with one slot changed. */
export function withRobotPart<Slot extends RobotSlot>(
  look: RobotLook,
  slot: Slot,
  id: RobotLook[Slot],
): RobotLook {
  return { ...look, [slot]: id };
}

const EARS =
  '<rect x="44" y="108" width="20" height="44" rx="8" fill="#c3cfda"/><rect x="192" y="108" width="20" height="44" rx="8" fill="#c3cfda"/>';
const NECK = '<rect x="110" y="174" width="36" height="22" rx="8" fill="#a9b8c6"/>';
const HEAD =
  '<rect x="58" y="68" width="140" height="116" rx="36" fill="#f1f5f8"/><path d="M58 146h140v2a36 36 0 0 1-36 36H94a36 36 0 0 1-36-36z" fill="#dde5ec"/><rect x="74" y="88" width="108" height="72" rx="24" fill="#1b2632"/><rect x="86" y="95" width="34" height="7" rx="3.5" fill="#fff" opacity=".12"/>';

/**
 * The robot as a standalone SVG document. Every piece is fixed artwork chosen by part id, so the
 * result is safe to use as an image source. Layers: backdrop, extra behind, outfit, neck, collar,
 * headwear behind, ears, steam, head, face, headwear in front, face in front.
 */
export function robotCharacterSvg(look: RobotLook): string {
  const hat = ROBOT_PART_ART.headwear[look.headwear];
  const eyes = ROBOT_PART_ART.face[look.face];
  const clothes = ROBOT_PART_ART.outfit[look.outfit];
  const more = ROBOT_PART_ART.extra[look.extra];
  const ears = look.headwear === "hood" ? "" : EARS;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
    `<rect width="256" height="256" fill="${ROBOT_COLOUR_FILLS[look.colour]}"/>`,
    more.back ?? "",
    clothes.back ?? "",
    NECK,
    clothes.front ?? "",
    (hat.back ?? "").replace("GLOW", ROBOT_COLOUR_GLOWS[look.colour]),
    ears,
    more.front ?? "",
    HEAD,
    eyes.back ?? "",
    hat.front ?? "",
    eyes.front ?? "",
    "</svg>",
  ].join("");
}

const dataUris = new Map<string, string>();

/** An image source for a robot character, drawn once per look and kept (at most one per combination). */
export function robotCharacterDataUri(look: RobotLook): string {
  const key = robotCharacterValue(look);
  let uri = dataUris.get(key);
  if (!uri) {
    uri = `data:image/svg+xml,${encodeURIComponent(robotCharacterSvg(look))}`;
    dataUris.set(key, uri);
  }
  return uri;
}
