import { randomInt } from "node:crypto";
import type { BotAvatarSet } from "@robots/contracts";
import { BOT_COLORS, parseBotAvatarValue } from "@robots/contracts";
import {
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarLook,
  ROBOT_PRESETS,
  resolvePersonaColorDef,
  robotPresetOf,
  robotPresetValue,
  seededLogoAvatarColor,
} from "@robots/core";

export type Random = () => number;

const RANDOM_RANGE = 2 ** 32;
const cryptoRandom: Random = () => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

export const BOT_ID_ATTEMPTS = 200;

export function pickLeastUsed<T>(
  options: readonly T[],
  used: readonly T[],
  random: Random,
  avoid: readonly T[] = [],
): T {
  const counts = options.map((option) => used.filter((value) => value === option).length);
  const fewest = Math.min(...counts);
  const least = options.filter((_, index) => counts[index] === fewest);
  const preferred = least.filter((option) => !avoid.includes(option));
  const candidates = preferred.length > 0 ? preferred : least;
  return candidates[Math.floor(random() * candidates.length)] ?? options[0]!;
}

export function chooseRobotCharacter(
  existing: readonly { color: string }[],
  random: Random = cryptoRandom,
): string {
  const worn = existing.flatMap((bot) => {
    const avatar = parseBotAvatarValue(bot.color);
    const preset = avatar.kind === "robot" ? robotPresetOf(avatar.look) : null;
    return preset ? [preset] : [];
  });
  return robotPresetValue(
    pickLeastUsed(
      ROBOT_PRESETS.map((preset) => preset.id),
      worn,
      random,
    ),
  );
}

function cuidShapedId(random: Random, now: number): string {
  let suffix = "";
  for (let index = 0; index < 16; index++) suffix += Math.floor(random() * 36).toString(36);
  return `c${now.toString(36).padStart(8, "0").slice(-8)}${suffix}`;
}

function balancedId(usedLooks: readonly number[], random: Random, now: number): string {
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

function idForFamily(family: number, random: Random, now: number): string {
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
    avatarSet = "organic",
    id: previewId,
  }: { random?: Random; now?: number; family?: number; avatarSet?: BotAvatarSet; id?: string } = {},
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
