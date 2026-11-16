import { useLingui } from "@lingui/react/macro";
import type { RobotLook } from "@robots/contracts";
import { robotCharacterValue } from "@robots/contracts";
import { BotAvatar } from "@robots/ui-web";

/** Ready-made robots a new bot starts from; the full builder stays in the bot's Avatar Studio. */
export const ROBOT_PRESETS = [
  {
    id: "assistant",
    look: { colour: "green", headwear: "antenna", face: "happy", outfit: "vest", extra: "none" },
  },
  {
    id: "researcher",
    look: {
      colour: "blue",
      headwear: "deerstalker",
      face: "magnifier",
      outfit: "tweed",
      extra: "none",
    },
  },
  {
    id: "coder",
    look: { colour: "teal", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  },
  {
    id: "writer",
    look: {
      colour: "purple",
      headwear: "mortarboard",
      face: "glasses",
      outfit: "turtleneck",
      extra: "none",
    },
  },
  {
    id: "analyst",
    look: {
      colour: "slate",
      headwear: "top-hat",
      face: "monocle",
      outfit: "tuxedo",
      extra: "none",
    },
  },
  {
    id: "creator",
    look: {
      colour: "pink",
      headwear: "antenna",
      face: "hearts",
      outfit: "t-shirt",
      extra: "ring-light",
    },
  },
  {
    id: "chef",
    look: {
      colour: "orange",
      headwear: "chef-hat",
      face: "happy",
      outfit: "chef-jacket",
      extra: "steam",
    },
  },
  {
    id: "hero",
    look: {
      colour: "red",
      headwear: "antenna",
      face: "aviators",
      outfit: "cape",
      extra: "confetti",
    },
  },
] as const satisfies ReadonlyArray<{ id: string; look: RobotLook }>;

export type RobotPresetId = (typeof ROBOT_PRESETS)[number]["id"];

export function robotPresetValue(id: RobotPresetId): string {
  const preset = ROBOT_PRESETS.find((candidate) => candidate.id === id) ?? ROBOT_PRESETS[0];
  return robotCharacterValue(preset.look);
}

export function randomRobotPreset(): RobotPresetId {
  return ROBOT_PRESETS[Math.floor(Math.random() * ROBOT_PRESETS.length)]!.id;
}

/** A grid of preset robots; picking one sets the new bot's look. */
export function RobotPresetPicker({
  value,
  onChange,
}: {
  value: RobotPresetId;
  onChange: (id: RobotPresetId) => void;
}) {
  const { t } = useLingui();
  const labels: Record<RobotPresetId, string> = {
    assistant: t`Assistant`,
    researcher: t`Researcher`,
    coder: t`Coder`,
    writer: t`Writer`,
    analyst: t`Analyst`,
    creator: t`Creator`,
    chef: t`Chef`,
    hero: t`Hero`,
  };
  return (
    <div role="radiogroup" aria-label={t`Character`} className="grid grid-cols-4 gap-2">
      {ROBOT_PRESETS.map((preset) => {
        const selected = preset.id === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a grid of picture buttons, not radio inputs
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labels[preset.id]}
            onClick={() => onChange(preset.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              selected
                ? "border-foreground bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <BotAvatar color={robotCharacterValue(preset.look)} size={44} />
            {labels[preset.id]}
          </button>
        );
      })}
    </div>
  );
}
