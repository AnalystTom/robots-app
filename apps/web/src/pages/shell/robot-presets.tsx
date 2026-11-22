import { useLingui } from "@lingui/react/macro";
import type { RobotPresetId } from "@robots/core";
import { ROBOT_PRESETS, robotPresetValue } from "@robots/core";
import { BotAvatar } from "@robots/ui-web";

function PresetTile({
  label,
  look,
  selected,
  onSelect,
}: {
  label: string;
  look: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid of picture buttons, not radio inputs
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? "border-foreground bg-accent text-foreground"
          : "border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      <BotAvatar color={look} size={44} />
      {label}
    </button>
  );
}

export function RobotPresetPicker({
  value,
  currentLook,
  onChange,
}: {
  value: RobotPresetId | null;
  currentLook?: string;
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
    hoodie: t`Hoodie`,
    critic: t`Critic`,
    professor: t`Professor`,
    detective: t`Detective`,
    keynote: t`Keynote`,
    hustler: t`Hustler`,
    host: t`Host`,
  };
  return (
    <div role="radiogroup" aria-label={t`Character`} className="grid grid-cols-4 gap-2">
      {currentLook ? (
        <PresetTile label={t`Current look`} look={currentLook} selected={value === null} />
      ) : null}
      {ROBOT_PRESETS.map((preset) => (
        <PresetTile
          key={preset.id}
          label={labels[preset.id]}
          look={robotPresetValue(preset.id)}
          selected={preset.id === value}
          onSelect={() => onChange(preset.id)}
        />
      ))}
    </div>
  );
}
