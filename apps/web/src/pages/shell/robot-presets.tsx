import { useLingui } from "@lingui/react/macro";
import type { RobotLook } from "@robots/contracts";
import { robotCharacterValue } from "@robots/contracts";
import { ROBOT_PRESETS, robotPresetOf, robotPresetValue } from "@robots/core";
import { robotPresetLabel } from "@robots/i18n/robot-presets";
import { BotAvatar } from "@robots/ui-web";

export function RobotPresetPicker({
  robot,
  onChange,
}: {
  robot: RobotLook | null;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const selectedPreset = robot ? robotPresetOf(robot) : null;
  const tileClass = (selected: boolean) =>
    `flex flex-col items-center gap-1 rounded-xl border p-2 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
      selected
        ? "border-foreground bg-accent text-foreground"
        : "border-border text-muted-foreground hover:bg-accent"
    }`;
  return (
    <div role="radiogroup" aria-label={t`Character`} className="grid grid-cols-4 gap-2">
      {robot && selectedPreset === null ? (
        // biome-ignore lint/a11y/useSemanticElements: a grid of picture buttons, not radio inputs
        <button
          type="button"
          role="radio"
          aria-checked={true}
          aria-label={t`Current look`}
          className={tileClass(true)}
        >
          <BotAvatar color={robotCharacterValue(robot)} size={44} />
          {t`Current look`}
        </button>
      ) : null}
      {ROBOT_PRESETS.map((preset) => {
        const selected = preset.id === selectedPreset;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a grid of picture buttons, not radio inputs
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={robotPresetLabel(preset.id)}
            onClick={() => onChange(robotPresetValue(preset.id))}
            className={tileClass(selected)}
          >
            <BotAvatar color={robotPresetValue(preset.id)} size={44} />
            {robotPresetLabel(preset.id)}
          </button>
        );
      })}
    </div>
  );
}
