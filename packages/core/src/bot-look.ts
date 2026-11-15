import type { BotAvatarSet, RobotLook } from "@robots/contracts";
import { parseBotAvatarValue } from "@robots/contracts";
import {
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarSampleIdentity,
} from "./avatar-shape.js";
import { DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef } from "./bot-avatar-colors.js";
import { newClientId } from "./client-id.js";
import { randomRobotCharacterValue } from "./robot-character.js";

/** One preview identity per organic look, so a new bot can show a body before it has an id. */
export const ORGANIC_PREVIEW_IDENTITIES = ORGANIC_AVATAR_LOOKS.map(organicAvatarSampleIdentity);

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)]!;
}

/** The look a bot being created starts with, before anyone picks. */
export interface NewBotLook {
  /** Reserved bot id; logo avatars draw from it, so creation keeps it. Never a heart body. */
  id: string;
  /** A random robot character until someone picks another look. */
  color: string;
  /** The organic body the preview draws. */
  identity: string;
}

export function newBotLook(): NewBotLook {
  let id: string;
  do {
    id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
  } while (organicAvatarFamily(id) === ORGANIC_AVATAR_HEART_FAMILY);
  return {
    id,
    color: randomRobotCharacterValue(),
    identity: pick(ORGANIC_PREVIEW_IDENTITIES),
  };
}

/** The identity the creation preview draws for the account's avatar set. */
export function newBotPreviewIdentity(avatarSet: BotAvatarSet, look: NewBotLook): string {
  return avatarSet === "robots" ? look.id : look.identity;
}

/** What `bots/create` needs so the new bot looks like its preview. */
export function newBotLookInput(
  avatarSet: BotAvatarSet,
  look: NewBotLook,
): { color: string; id?: string; avatarFamily?: number } {
  // A robot character draws the same in every set.
  if (botLookState(look.color).robot) return { color: look.color, id: look.id };
  // The logo has no studio shapes, so a shape picked before the set was known is dropped.
  if (avatarSet === "robots") return { color: botLookState(look.color).color, id: look.id };
  // A studio shape replaces the organic body, so the family would mean nothing.
  if (botLookState(look.color).shapeIndex !== null) return { color: look.color };
  return { color: look.color, avatarFamily: organicAvatarFamily(look.identity) };
}

/** What a look picker shows as chosen for a stored avatar value. */
export interface BotLookState {
  photo: boolean;
  shapeIndex: number | null;
  /** The palette color; a bot saved with a color's earlier, deeper value still selects it. */
  color: string;
  /** The robot character's parts, when the look is one. */
  robot: RobotLook | null;
  /** Neither a photo, a studio shape nor a robot character: the bot's own body. */
  defaultLook: boolean;
}

export function botLookState(value: string): BotLookState {
  const parsed = parseBotAvatarValue(value);
  const photo = parsed.kind === "image";
  const shapeIndex = parsed.kind === "shape" ? parsed.shapeIndex : null;
  const robot = parsed.kind === "robot" ? parsed.look : null;
  const stored =
    parsed.kind === "color" || parsed.kind === "shape" || parsed.kind === "robot"
      ? parsed.color
      : DEFAULT_BOT_AVATAR_COLOR;
  return {
    photo,
    shapeIndex,
    color: resolvePersonaColorDef("preview", stored).hex,
    robot,
    defaultLook: !photo && shapeIndex === null && robot === null,
  };
}

export function botLookWithShape(color: string, shapeIndex: number): string {
  return `${color}::shape_${shapeIndex}`;
}

/** Keeps a chosen shape when the color changes; a photo is replaced by the color. */
export function botLookWithColor(value: string, color: string): string {
  const { shapeIndex } = botLookState(value);
  return shapeIndex === null ? color : botLookWithShape(color, shapeIndex);
}
