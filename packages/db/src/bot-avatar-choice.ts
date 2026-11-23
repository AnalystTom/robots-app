import { randomInt } from "node:crypto";
import type { BotAvatarSet } from "@robots/contracts";
import { BOT_COLORS, parseBotAvatarValue } from "@robots/contracts";
import type { UnitIntervalRandom } from "@robots/core";
import {
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarLook,
  pickLeastUsed,
  ROBOT_PRESET_IDS,
  resolvePersonaColorDef,
  robotPresetValue,
  seededLogoAvatarColor,
  wornRobotPresetIds,
} from "@robots/core";

const RANDOM_RANGE = 2 ** 32;
const cryptoRandom: UnitIntervalRandom = () => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

export const BOT_ID_ATTEMPTS = 200;

export function chooseRobotCharacter(
  existing: readonly { color: string }[],
  random: UnitIntervalRandom = cryptoRandom,
): string {
  return robotPresetValue(
    pickLeastUsed(ROBOT_PRESET_IDS, wornRobotPresetIds(existing.map((bot) => bot.color)), random),
  );
}

function cuidShapedId(random: UnitIntervalRandom, now: number): string {
  let suffix = "";
  for (let index = 0; index < 16; index++) suffix += Math.floor(random() * 36).toString(36);
  return `c${now.toString(36).padStart(8, "0").slice(-8)}${suffix}`;
}

function balancedId(usedLooks: readonly number[], random: UnitIntervalRandom, now: number): string {
  const look = pickLeastUsed(ORGANIC_AVATAR_LOOKS, usedLooks, random);
  const isHeart = (botId: string) => organicAvatarFamily(botId) === ORGANIC_AVATAR_HEART_FAMILY;
  let id = cuidShapedId(random, now);
  let lastNonHeart = isHeart(id) ? undefined : id;
  for (
    let attempt = 1;
    attempt < BOT_ID_ATTEMPTS && organicAvatarLook(organicAvatarFamily(id)) !== look;
    attempt++
  ) {
    id = cuidShapedId(random, now);
    if (!isHeart(id)) lastNonHeart = id;
  }
  if (isHeart(id) && lastNonHeart) id = lastNonHeart;
  while (isHeart(id)) id = cuidShapedId(random, now);
  return id;
}

function idForFamily(family: number, random: UnitIntervalRandom, now: number): string {
  let id = cuidShapedId(random, now);
  while (organicAvatarFamily(id) !== family) id = cuidShapedId(random, now);
  return id;
}

export function chooseBotAvatar(
  existing: readonly { id: string; color: string }[],
  color: string | undefined,
  {
    random = cryptoRandom,
    now = Date.now(),
    family,
    avatarSet,
    id: previewId,
  }: {
    random?: UnitIntervalRandom;
    now?: number;
    family?: number;
    avatarSet: BotAvatarSet;
    id?: string;
  },
): { id: string; color: string } {
  if (avatarSet === "robots") {
    if (previewId) return { id: previewId, color: color ?? seededLogoAvatarColor(previewId) };
    let id = family === undefined ? cuidShapedId(random, now) : idForFamily(family, random, now);
    while (family === undefined && organicAvatarFamily(id) === ORGANIC_AVATAR_HEART_FAMILY)
      id = cuidShapedId(random, now);
    return { id, color: color ?? seededLogoAvatarColor(id) };
  }
  const avatars = existing.map((bot) => {
    const avatar = parseBotAvatarValue(bot.color);
    return {
      look:
        avatar.kind === "color" || avatar.kind === "other"
          ? organicAvatarLook(organicAvatarFamily(bot.id))
          : null,
      color:
        avatar.kind === "color" || avatar.kind === "shape"
          ? resolvePersonaColorDef(bot.id, avatar.color).hex.toUpperCase()
          : null,
    };
  });
  const lookOf = (botId: string) => organicAvatarLook(organicAvatarFamily(botId));
  const id =
    previewId ??
    (family === undefined
      ? balancedId(
          avatars.flatMap((avatar) => (avatar.look === null ? [] : [avatar.look])),
          random,
          now,
        )
      : idForFamily(family, random, now));
  const colors = (bots: typeof avatars) =>
    bots.flatMap((avatar) => (avatar.color === null ? [] : [avatar.color]));
  return {
    id,
    color:
      color ??
      pickLeastUsed(
        BOT_COLORS,
        colors(avatars),
        random,
        colors(avatars.filter((avatar) => avatar.look === lookOf(id))),
      ),
  };
}
