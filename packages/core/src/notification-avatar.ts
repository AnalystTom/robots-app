import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterDataUri } from "./robot-character.js";
import { robotLookForIdentity } from "./robot-presets.js";

export function notificationAvatarSource(bot: { id: string; color: string }): string {
  const drawn = robotLookForIdentity(bot.color, bot.id);
  const look = parseRobotCharacter(drawn);
  return look ? robotCharacterDataUri(look) : drawn;
}
