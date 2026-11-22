import { useLingui } from "@lingui/react/macro";
import type { RobotPresetId } from "@robots/core";
import { ROBOT_PRESETS, robotPresetValue } from "@robots/core";
import { BotAvatar } from "@robots/ui-web";

export function RobotPresetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
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
    hoodie: t`Hoodie`,
    critic: t`Critic`,
    professor: t`Professor`,
    detective: t`Detective`,
    keynote: t`Keynote`,
    hustler: t`Hustler`,
    host: t`Host`,
  };
  const choices = ROBOT_PRESETS.map((preset) => ({
    key: preset.id,
    label: labels[preset.id],
    value: robotPresetValue(preset.id),
  }));
  return (
    <div role="radiogroup" aria-label={t`Character`} className="grid grid-cols-4 gap-2">
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a grid of picture buttons, not radio inputs
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={choice.label}
            onClick={() => onChange(choice.value)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              selected
                ? "border-foreground bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <BotAvatar color={choice.value} size={44} />
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
