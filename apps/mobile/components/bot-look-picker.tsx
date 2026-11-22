import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { BotAvatarSet } from "@robots/contracts";
import { BOT_COLORS } from "@robots/contracts";
import type { RobotPresetId } from "@robots/core";
import {
  botLookState,
  botLookWithColor,
  botLookWithShape,
  ROBOT_PRESETS,
  robotPresetOf,
  robotPresetValue,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
} from "@robots/core";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useMobileTokens } from "../lib/native";
import { BotAvatar } from "./bot-avatar";

const ROBOT_SIZE = 48;

export function BotLookPicker({
  value,
  identity,
  organicIdentities,
  avatarSet,
  disabled = false,
  onChange,
}: {
  value: string;
  identity?: string;
  organicIdentities?: readonly string[];
  avatarSet: BotAvatarSet;
  disabled?: boolean;
  onChange: (value: string, identity?: string) => void;
}) {
  const { t } = useLingui();
  const { photo, shapeIndex: shape, color, robot, defaultLook } = botLookState(value);
  const labeled = !organicIdentities;
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
    <View style={{ gap: 20 }}>
      <View>
        {labeled ? <Label>{t`Robot`}</Label> : null}
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
      {avatarSet === "organic" ? (
        <View>
          {labeled ? <Label>{t`Shape`}</Label> : null}
          <View accessibilityRole="radiogroup" style={grid}>
            {organicIdentities ? (
              organicIdentities.map((organic, index) => (
                <Choice
                  disabled={disabled}
                  key={organic}
                  label={t`Shape ${ph({ number: index + 1 })}`}
                  selected={defaultLook && identity === organic}
                  onPress={() => onChange(color, organic)}
                >
                  <BotAvatar color={color} identity={organic} size={40} />
                </Choice>
              ))
            ) : (
              <Choice
                disabled={disabled}
                label={t`Default`}
                selected={defaultLook}
                onPress={() => onChange(color)}
              >
                <BotAvatar color={color} identity={identity} size={40} />
              </Choice>
            )}
            {SHIPPED_BOT_AVATAR_SHAPE_KEYS.map((key, index) => (
              <Choice
                disabled={disabled}
                key={key}
                label={t`Shape ${ph({ number: index + 1 + (organicIdentities?.length ?? 0) })}`}
                selected={shape === index}
                onPress={() => onChange(botLookWithShape(color, index))}
              >
                <BotAvatar color={botLookWithShape(color, index)} identity={identity} size={40} />
              </Choice>
            ))}
          </View>
        </View>
      ) : null}
      {robot ? null : (
        <View>
          {labeled ? <Label>{t`Color`}</Label> : null}
          <View accessibilityRole="radiogroup" style={grid}>
            {BOT_COLORS.map((option, index) => (
              <Swatch
                key={option}
                fill={option}
                label={t`Color ${ph({ number: index + 1 })}`}
                selected={!photo && color.toLowerCase() === option.toLowerCase()}
                disabled={disabled}
                onPress={() => onChange(botLookWithColor(value, option))}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const grid = {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "center",
  gap: 10,
} as const;

function Label({ children }: { children: string }) {
  const tokens = useMobileTokens();
  return (
    <Text style={{ color: tokens.mutedForeground, fontSize: 14, marginBottom: 8 }}>{children}</Text>
  );
}

function Swatch({
  fill,
  label,
  selected,
  disabled,
  onPress,
}: {
  fill: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
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
        width: 40,
        height: 40,
        borderRadius: 20,
        padding: 3,
        borderWidth: 2,
        borderColor: selected ? tokens.foreground : "transparent",
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: 20,
          backgroundColor: fill,
          borderWidth: 1,
          borderColor: tokens.border,
        }}
      />
    </Pressable>
  );
}

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
