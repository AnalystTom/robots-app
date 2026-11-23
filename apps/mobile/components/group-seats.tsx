import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterSvg, robotsOnlyAvatarValue } from "@robots/core";
import type { ReactNode } from "react";
import { memo, useId } from "react";
import type { ColorValue } from "react-native";
import { View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image,
  Mask,
  Path,
  Rect,
  Text as SvgText,
  SvgXml,
} from "react-native-svg";
import type { GroupSeat } from "../lib/group-seats";
import {
  GROUP_SEAT_SIZE,
  groupSeatGap,
  groupSeatStep,
  groupSeats,
  groupSeatsWidth,
} from "../lib/group-seats";
import { native, useResolvedAppearance } from "../lib/native";

type SeatMember = { botId?: string; name?: string; color: string };

type Paint = { fill: ColorValue; stroke?: string; strokeWidth?: number };

type SeatArt = {
  box: [number, number, number];
  outline: (paint: Paint) => ReactNode;
  face: ReactNode;
};

const ROBOT_CHARACTER_UNITS = 256;

export const GroupSeats = memo(function GroupSeats({
  members,
  size = GROUP_SEAT_SIZE,
}: {
  members: readonly SeatMember[];
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  useResolvedAppearance();
  const seats = groupSeats(members);
  const step = groupSeatStep(size);
  const gap = groupSeatGap(size);
  const width = groupSeatsWidth(seats.length, size);
  const arts = seats.map((seat, index) =>
    seat.kind === "member"
      ? seatArt(seat.member, size, `${id}-${index}`)
      : markArt(seat, size, native.systemTertiaryLabel),
  );
  const placed = (index: number, art: SeatArt) => {
    const [x, y, units] = art.box;
    return `translate(${index * step} 0) scale(${size / units}) translate(${-x} ${-y})`;
  };
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width, height: size }}
    >
      <Svg width={width} height={size}>
        <Defs>
          {arts.slice(1).map((next, before) => (
            <Mask
              key={before}
              id={`${id}-carve-${before}`}
              maskUnits="userSpaceOnUse"
              x={0}
              y={-size}
              width={width}
              height={size * 3}
            >
              <Rect x={0} y={-size} width={width} height={size * 3} fill="white" />
              <G transform={placed(before + 1, next)} strokeLinejoin="round">
                {next.outline({
                  fill: "black",
                  stroke: "black",
                  strokeWidth: (2 * gap * next.box[2]) / size,
                })}
              </G>
            </Mask>
          ))}
        </Defs>
        {arts.map((art, index) => (
          <G key={index} mask={arts[index + 1] ? `url(#${id}-carve-${index})` : undefined}>
            <G transform={placed(index, art)}>{art.face}</G>
          </G>
        ))}
      </Svg>
    </View>
  );
});

function markArt(
  seat: Exclude<GroupSeat<SeatMember>, { kind: "member" }>,
  size: number,
  color: ColorValue,
): SeatArt {
  if (seat.kind === "group") {
    const hash = (paint: Paint) => (
      <Path
        d="M9.5 4L8 20M16 4L14.5 20M4.5 9H20M4 15H19.5"
        fill="none"
        stroke={paint.stroke ?? paint.fill}
        strokeWidth={2 + (paint.strokeWidth ?? 0)}
        strokeLinecap="round"
      />
    );
    return { box: [0, 0, 24], outline: hash, face: hash({ fill: color }) };
  }
  const fontSize = Math.round(size * 0.74);
  const label = (paint: Paint) => (
    <SvgText
      x={size / 2}
      y={size / 2 + fontSize * 0.36}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight="600"
      {...paint}
    >
      {`+${seat.count}`}
    </SvgText>
  );
  return { box: [0, 0, size], outline: label, face: label({ fill: color }) };
}

function seatArt(member: SeatMember, size: number, key: string): SeatArt {
  const value = robotsOnlyAvatarValue(member.color, member.botId);
  const look = parseRobotCharacter(value);
  const units = look ? ROBOT_CHARACTER_UNITS : size;
  const r = units / 2;
  return {
    box: [0, 0, units],
    outline: (paint) => <Circle cx={r} cy={r} r={r} {...paint} />,
    face: (
      <>
        <ClipPath id={`${key}-picture`}>
          <Circle cx={r} cy={r} r={r} />
        </ClipPath>
        <Circle cx={r} cy={r} r={r} fill={native.fill} />
        <G clipPath={`url(#${key}-picture)`}>
          {look ? (
            <SvgXml xml={robotCharacterSvg(look)} width={units} height={units} />
          ) : (
            <Image
              href={{ uri: value }}
              width={size}
              height={size}
              preserveAspectRatio="xMidYMid slice"
            />
          )}
        </G>
      </>
    ),
  };
}
