import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterDataUri } from "./robot-character.js";
import { robotsOnlyAvatarValue } from "./robot-presets.js";

export function notificationAvatarSource(bot: { id: string; color: string }): string {
  const value = robotsOnlyAvatarValue(bot.color, bot.id);
  const look = parseRobotCharacter(value);
  return look ? robotCharacterDataUri(look) : value;
}
