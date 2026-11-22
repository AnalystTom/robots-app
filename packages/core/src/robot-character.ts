import type { RobotLook } from "@robots/contracts";
import { ROBOT_COLOUR_FILLS, robotCharacterValue } from "@robots/contracts";
import { ROBOT_COLOUR_GLOWS, ROBOT_PART_ART } from "./robot-character-parts.js";

const EARS =
  '<rect x="44" y="108" width="20" height="44" rx="8" fill="#c3cfda"/><rect x="192" y="108" width="20" height="44" rx="8" fill="#c3cfda"/>';
const NECK = '<rect x="110" y="174" width="36" height="22" rx="8" fill="#a9b8c6"/>';
const HEAD =
  '<rect x="58" y="68" width="140" height="116" rx="36" fill="#f1f5f8"/><path d="M58 146h140v2a36 36 0 0 1-36 36H94a36 36 0 0 1-36-36z" fill="#dde5ec"/><rect x="74" y="88" width="108" height="72" rx="24" fill="#1b2632"/><rect x="86" y="95" width="34" height="7" rx="3.5" fill="#fff" opacity=".12"/>';

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

export function robotCharacterDataUri(look: RobotLook): string {
  const key = robotCharacterValue(look);
  let uri = dataUris.get(key);
  if (!uri) {
    uri = `data:image/svg+xml,${encodeURIComponent(robotCharacterSvg(look))}`;
    dataUris.set(key, uri);
  }
  return uri;
}
