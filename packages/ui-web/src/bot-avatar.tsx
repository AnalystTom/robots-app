import type { BotAvatarSet, BotColorDef } from "@robots/contracts";
import {
  BOT_COLOR_LIST,
  BOT_COLORS,
  parseRobotCharacter,
  ROBOT_COLOUR_FILLS,
} from "@robots/contracts";
import type { LogoAvatarActivity } from "@robots/core";
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_BOT_AVATAR_COLOR,
  resolvePersonaColorDef,
  robotCharacterDataUri,
  robotsOnlyAvatarValue,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
} from "@robots/core";
import { memo, useMemo } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";

export type { BotColorDef };
export { BOT_COLOR_LIST, BOT_COLORS, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

const SHIPPED_SHAPE_KEYS = SHIPPED_BOT_AVATAR_SHAPE_KEYS;

export function parseBotAvatar(
  rawColor: string,
  _identity?: string,
): {
  color: string;
  shapeIndex?: number;
  isImage: boolean;
  imageUrl?: string;
} {
  if (!rawColor) return { color: "#F97316", isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  if (rawColor.startsWith("data:image/")) {
    return { color: "#F97316", isImage: true, imageUrl: rawColor };
  }
  // A robot character is drawn from fixed parts; its colour is its backdrop.
  const robot = parseRobotCharacter(rawColor);
  if (robot) {
    return {
      color: ROBOT_COLOUR_FILLS[robot.colour],
      isImage: true,
      imageUrl: robotCharacterDataUri(robot),
    };
  }
  if (rawColor.includes("::shape_")) {
    const parts = rawColor.split("::shape_");
    const rawShapeIdx = parts[1] ?? "0";
    const parsedShapeIdx = /^\d+$/.test(rawShapeIdx) ? Number(rawShapeIdx) : 0;
    const shapeIdx = Number.isSafeInteger(parsedShapeIdx) ? parsedShapeIdx : 0;
    return {
      color: parts[0] || "#F97316",
      shapeIndex: shapeIdx % SHIPPED_SHAPE_KEYS.length,
      isImage: false,
    };
  }
  return { color: rawColor, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The plain colour value for an avatar; a robot character gives its backdrop. */
export function defaultBotAvatarValue(rawColor: string): string {
  const robot = parseRobotCharacter(rawColor);
  if (robot) return ROBOT_COLOUR_FILLS[robot.colour];
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

export interface BotAvatarProps {
  color: string;
  avatarSet?: BotAvatarSet;
  activity?: LogoAvatarActivity;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  size = 36,
  status,
  identity = "",
  className,
}: BotAvatarProps) {
  const isWorking = ACTIVE_RUN_STATUSES.some((s) => s === status);
  const imageUrl = useMemo(
    () => parseBotAvatar(robotsOnlyAvatarValue(color, identity)).imageUrl,
    [color, identity],
  );
  if (!imageUrl) return null;
  return <PictureAvatar src={imageUrl} size={size} isWorking={isWorking} className={className} />;
});

/** A photo or a robot character, in a circle, with the working ring around it. */
function PictureAvatar({
  src,
  size,
  isWorking,
  className,
}: {
  src: string;
  size: number;
  isWorking: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("robots-bot-avatar relative shrink-0 select-none", className)}
      data-working={isWorking}
      style={{ width: size, height: size }}
    >
      <div className="robots-bot-avatar-picture relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
        <img src={src} alt="" className="h-full w-full object-cover" />
      </div>
      {isWorking ? (
        <svg
          className="robots-bot-avatar-ring robots-bot-avatar-ring-working absolute pointer-events-none"
          style={{
            inset: -4,
            width: size + 8,
            height: size + 8,
          }}
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="24"
            cy="24"
            r="22"
            className="stroke-status-working"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeDasharray="45 80"
          />
        </svg>
      ) : null}
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-card">
        <span className="h-4 w-[7px] rounded-full bg-primary" />
        <span className="h-4 w-[7px] rounded-full bg-primary" />
      </div>
      {/* off-scale: wordmark sized to the 44px logo mark */}
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        RoBots
      </span>
    </div>
  );
}
