import { useLingui } from "@lingui/react/macro";
import type { RobotPresetId } from "@robots/core";
import {
  botLookState,
  ROBOT_PRESETS,
  robotPresetOf,
  robotPresetValue,
  robotsOnlyAvatarValue,
} from "@robots/core";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useMobileTokens } from "../lib/native";
import { BotAvatar } from "./bot-avatar";

const ROBOT_SIZE = 48;

export function BotLookPicker({
  value,
  identity,
  disabled = false,
  onChange,
}: {
  value: string;
  identity?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const { robot } = botLookState(robotsOnlyAvatarValue(value, identity));
  const pickedPreset = robot ? robotPresetOf(robot) : null;
  const presetLabels: Record<RobotPresetId, string> = {
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
    <View>
      <View accessibilityRole="radiogroup" style={grid}>
        {ROBOT_PRESETS.map((preset) => {
          const look = robotPresetValue(preset.id);
          return (
            <Choice
              disabled={disabled}
              key={preset.id}
              label={presetLabels[preset.id]}
              selected={preset.id === pickedPreset}
              onPress={() => onChange(look)}
            >
              <BotAvatar color={look} size={ROBOT_SIZE} />
            </Choice>
          );
        })}
      </View>
    </View>
  );
}

const grid = {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 10,
} as const;

function Choice({
  disabled,
  label,
  selected,
  onPress,
  children,
}: {
  disabled: boolean;
  label: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const tokens = useMobileTokens();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 4,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: selected ? tokens.foreground : "transparent",
      }}
    >
      {children}
    </Pressable>
  );
}
