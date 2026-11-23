import { parseBotAvatarValue } from "@robots/contracts";
import { robotCharacterDataUri } from "./robot-character.js";
import { ROBOT_PRESETS, robotLookForIdentity } from "./robot-presets.js";

export function notificationAvatarSource(bot: {
  id: string;
  color: string;
  avatarSet?: string | null;
}): string {
  const parsed = parseBotAvatarValue(robotLookForIdentity(bot.color, bot.id));
  if (parsed.kind === "image") return parsed.imageUrl;
  return robotCharacterDataUri(parsed.kind === "robot" ? parsed.look : ROBOT_PRESETS[0].look);
}
