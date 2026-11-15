import type { BotAvatarSet, RobotLook } from "@robots/contracts";
import { BOT_COLORS, parseBotAvatarValue } from "@robots/contracts";
import {
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarSampleIdentity,
} from "./avatar-shape.js";
import { DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef } from "./bot-avatar-colors.js";
import { newClientId } from "./client-id.js";
import { randomRobotPreset, robotPresetValue } from "./robot-presets.js";

export const ORGANIC_PREVIEW_IDENTITIES = ORGANIC_AVATAR_LOOKS.map(organicAvatarSampleIdentity);

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)]!;
}

export interface NewBotLook {
  id: string;
  /** A random robot character until someone picks another look. */
  color: string;
  identity: string;
}

export function newBotLook(avatarSet: BotAvatarSet): NewBotLook {
  let id: string;
  do {
    id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
  } while (organicAvatarFamily(id) === ORGANIC_AVATAR_HEART_FAMILY);
  return newBotLookForSet(
    { id, color: pick(BOT_COLORS), identity: pick(ORGANIC_PREVIEW_IDENTITIES) },
    avatarSet,
  );
}

export function newBotLookForSet(look: NewBotLook, avatarSet: BotAvatarSet): NewBotLook {
  const { robot } = botLookState(look.color);
  if (avatarSet === "robots") {
    return robot ? look : { ...look, color: robotPresetValue(randomRobotPreset()) };
  }
  return robot ? { ...look, color: pick(BOT_COLORS) } : look;
}

export function newBotPreviewIdentity(avatarSet: BotAvatarSet, look: NewBotLook): string {
  return avatarSet === "robots" ? look.id : look.identity;
}

export function newBotLookInput(
  avatarSet: BotAvatarSet,
  look: NewBotLook,
): { color: string; id?: string; avatarFamily?: number } {
  if (botLookState(look.color).robot) return { color: look.color, id: look.id };
  if (avatarSet === "robots") return { color: botLookState(look.color).color, id: look.id };
  if (botLookState(look.color).shapeIndex !== null) return { color: look.color };
  return { color: look.color, avatarFamily: organicAvatarFamily(look.identity) };
}

export interface BotLookState {
  photo: boolean;
  shapeIndex: number | null;
  color: string;
  robot: RobotLook | null;
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

export function botLookWithColor(value: string, color: string): string {
  const { shapeIndex } = botLookState(value);
  return shapeIndex === null ? color : botLookWithShape(color, shapeIndex);
}
