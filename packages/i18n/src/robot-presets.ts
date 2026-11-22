import { i18n } from "@lingui/core";
import type { RobotPresetId } from "@robots/core";

const ROBOT_PRESET_MESSAGES: Record<RobotPresetId, string> = {
  assistant: "Assistant",
  researcher: "Researcher",
  coder: "Coder",
  writer: "Writer",
  analyst: "Analyst",
  creator: "Creator",
  chef: "Chef",
  hero: "Hero",
  hoodie: "Hoodie",
  critic: "Critic",
  professor: "Professor",
  detective: "Detective",
  keynote: "Keynote",
  hustler: "Hustler",
  host: "Host",
};

export function robotPresetLabel(id: RobotPresetId): string {
  return i18n._({ id: `robot-preset.${id}`, message: ROBOT_PRESET_MESSAGES[id] });
}
