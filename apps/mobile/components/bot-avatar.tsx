import { useLingui } from "@lingui/react/macro";
import type { BotAvatarSet, RobotLook } from "@robots/contracts";
import type { AvatarMotionMode, LogoAvatarActivity } from "@robots/core";
import {
  AVATAR_MOTION_UNITS,
  avatarClock,
  avatarLifeState,
  avatarThinkingDot,
  avatarWorkingDot,
  isRunWorking,
  robotCharacterSvg,
  robotsOnlyAvatarValue,
} from "@robots/core";
import { memo, useMemo } from "react";
import { Image, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import type { AvatarLife } from "../lib/avatar-life";
import { useAvatarOnScreen, useLife, usePoke, useSettling } from "../lib/avatar-life";
import { mobileBotAvatarPresentation } from "../lib/bot-avatar";
import { useMobileTokens } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

export interface BotAvatarProps {
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  avatarSet?: BotAvatarSet;
  activity?: LogoAvatarActivity;
  muted?: boolean;
  motion?: AvatarMotionMode;
  composing?: boolean;
  pokeable?: boolean;
}

export const BotAvatar = memo(function BotAvatar(props: BotAvatarProps) {
  return <LegacyBotAvatar {...props} color={robotsOnlyAvatarValue(props.color, props.identity)} />;
});

function WorkingDot({ size, muted }: { size: number; muted: boolean }) {
  const tokens = useMobileTokens();
  const { t } = useLingui();
  const dot = avatarWorkingDot(size);
  return (
    <View
      accessibilityLabel={t`Working`}
      style={{
        position: "absolute",
        right: muted ? undefined : dot.inset - dot.ring,
        left: muted ? dot.inset - dot.ring : undefined,
        bottom: dot.inset - dot.ring,
        width: dot.diameter + dot.ring * 2,
        height: dot.diameter + dot.ring * 2,
        borderRadius: size,
        borderWidth: dot.ring,
        borderColor: tokens.background,
        backgroundColor: tokens.workingDot,
      }}
    />
  );
}

function MutedBadge({ size }: { size: number }) {
  const tokens = useMobileTokens();
  const { t } = useLingui();
  return (
    <View
      accessible
      accessibilityLabel={t`Notifications silenced`}
      style={{
        position: "absolute",
        right: -2,
        bottom: -2,
        width: Math.max(14, Math.round(size * 0.34)),
        height: Math.max(14, Math.round(size * 0.34)),
        borderRadius: size,
        borderWidth: 2,
        borderColor: tokens.background,
        backgroundColor: tokens.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: size,
          backgroundColor: tokens.secondary,
        }}
      />
      <NativeSymbol
        ios="bell.slash.fill"
        android="notifications-off"
        size={Math.max(8, Math.round(size * 0.17))}
        color={tokens.foreground}
      />
    </View>
  );
}

function LegacyBotAvatar({
  color,
  size = 54,
  status,
  muted = false,
  motion = "static",
  composing = false,
  pokeable = false,
}: {
  color: string;
  size?: number;
  status?: string;
  muted?: boolean;
  motion?: AvatarMotionMode;
  composing?: boolean;
  pokeable?: boolean;
}) {
  const tokens = useMobileTokens();
  const state = avatarLifeState(status, composing);
  const isWorking = isRunWorking(status) && !composing && motion !== "running";
  const parsed = mobileBotAvatarPresentation(color);
  const fillColor =
    parsed.kind === "shape" || parsed.kind === "color" || parsed.kind === "robot"
      ? parsed.color
      : color;
  const picturePainted = parsed.kind === "image" || parsed.kind === "robot";
  const onScreen = useAvatarOnScreen();
  const reducedMotion = useReducedMotion();
  const settling = useSettling(state);
  const clock = avatarClock({
    mode: motion,
    onScreen,
    hasEyes: !picturePainted,
    size,
    state,
    settling,
    reducedMotion,
  });
  const life = useLife(state, clock, size, motion);
  const poke = usePoke(life, pokeable && clock === "running");
  const picture =
    parsed.kind === "image" && parsed.imageUrl ? (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          backgroundColor: tokens.secondary,
        }}
      >
        <Image source={{ uri: parsed.imageUrl }} style={{ width: size, height: size }} />
      </View>
    ) : parsed.kind === "robot" ? (
      <RobotCharacter look={parsed.look} size={size} />
    ) : null;
  const avatar = (
    <View style={{ width: size, height: size }}>
      {picture}
      {!picturePainted && clock !== "still" ? (
        <ThinkingDots color={fillColor} size={size} life={life} />
      ) : null}
      {isWorking ? <WorkingDot size={size} muted={muted} /> : null}
      {muted ? <MutedBadge size={size} /> : null}
    </View>
  );
  return pokeable ? (
    <Pressable accessible={false} onPress={poke}>
      {avatar}
    </Pressable>
  ) : (
    avatar
  );
}

function ThinkingDots({ color, size, life }: { color: string; size: number; life: AvatarLife }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: size, height: size }}>
      <Dot slot={0} color={color} size={size} life={life} />
      <Dot slot={1} color={color} size={size} life={life} />
      <Dot slot={2} color={color} size={size} life={life} />
    </View>
  );
}

function Dot({
  slot,
  color,
  size,
  life,
}: {
  slot: 0 | 1 | 2;
  color: string;
  size: number;
  life: AvatarLife;
}) {
  const style = useAnimatedStyle(() => {
    const dot = avatarThinkingDot(slot, life.seconds.value, life.morph.value);
    const unit = size / AVATAR_MOTION_UNITS;
    const radius = dot.radius * unit;
    return {
      opacity: dot.opacity,
      width: radius * 2,
      height: radius * 2,
      borderRadius: radius,
      left: size / 2 + dot.x * unit - radius,
      top: size / 2 + dot.y * unit - radius,
    };
  });
  return <Animated.View style={[{ position: "absolute", backgroundColor: color }, style]} />;
}

const RobotCharacter = memo(function RobotCharacter({
  look,
  size,
}: {
  look: RobotLook;
  size: number;
}) {
  const xml = useMemo(() => robotCharacterSvg(look), [look]);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
});
