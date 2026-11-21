import { useLingui } from "@lingui/react/macro";
import type { RobotPresetId } from "@robots/core";
import { ROBOT_PRESETS, robotPresetValue } from "@robots/core";
import { BotAvatar } from "@robots/ui-web";

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
            <BotAvatar color={robotPresetValue(preset.id)} size={44} />
            {labels[preset.id]}
          </button>
        );
      })}
    </div>
  );
}
