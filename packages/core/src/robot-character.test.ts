import type { RobotLook } from "@robots/contracts";
import { ROBOT_PARTS } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { notificationAvatarSource } from "./notification-avatar.js";
import { robotCharacterDataUri, robotCharacterSvg } from "./robot-character.js";
import type { RobotPresetId } from "./robot-presets.js";
import { ROBOT_PRESETS, robotPresetValue } from "./robot-presets.js";

function listed(id: RobotPresetId): RobotLook {
  return ROBOT_PRESETS.find((preset) => preset.id === id)!.look;
}

function* everyLook(): Generator<RobotLook> {
  for (const colour of ROBOT_PARTS.colour)
    for (const headwear of ROBOT_PARTS.headwear)
      for (const face of ROBOT_PARTS.face)
        for (const outfit of ROBOT_PARTS.outfit)
          for (const extra of ROBOT_PARTS.extra) yield { colour, headwear, face, outfit, extra };
}

describe("robotCharacterSvg", () => {
  it("draws a standalone 256x256 document with the colour's backdrop first", () => {
    const svg = robotCharacterSvg(listed("host"));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"')).toBe(
      true,
    );
    expect(svg).toContain('<rect width="256" height="256" fill="#3457C9"/>');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("draws every combination as well-formed, static art", () => {
    let count = 0;
    for (const look of everyLook()) {
      const svg = robotCharacterSvg(look);
      count++;
      expect(svg).not.toMatch(/undefined|GLOW|<script|on\w+=|href=/i);
      const opened = svg.match(/<[a-zA-Z]/g)?.length ?? 0;
      const selfClosed = svg.match(/\/>/g)?.length ?? 0;
      const closed = svg.match(/<\/[a-zA-Z]+>/g)?.length ?? 0;
      expect(opened).toBe(selfClosed + closed);
    }
    expect(count).toBe(8 * 6 * 8 * 8 * 4);
  });

  it("drops the ears under the hood and lights the antenna in the colour's glow", () => {
    expect(robotCharacterSvg(listed("hoodie"))).not.toContain('x="44" y="108"');
    expect(robotCharacterSvg(listed("keynote"))).toContain('x="44" y="108"');
    expect(robotCharacterSvg(listed("hustler"))).toContain('fill="#fde68a"');
  });

  it("layers the parts back to front", () => {
    const svg = robotCharacterSvg(listed("critic"));
    const backToFront = {
      backdrop: 'fill="#D9483B"',
      chefsJacket: 'fill="#f8fafc"',
      neck: 'fill="#a9b8c6"',
      collar: 'fill="#1f2a44"',
      ears: 'fill="#c3cfda"',
      steam: 'stroke="#fff"',
      head: 'fill="#f1f5f8"',
      grumpyFace: 'stroke="#ff7a66"',
      chefsHat: 'fill="#fff"><circle',
    };
    const order = Object.values(backToFront).map((marker) => svg.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("encodes a data URI once per look", () => {
    const uri = robotCharacterDataUri(listed("professor"));
    expect(uri.startsWith("data:image/svg+xml,%3Csvg")).toBe(true);
    expect(robotCharacterDataUri({ ...listed("professor") })).toBe(uri);
  });

  it("is the notification portrait for a robot bot", () => {
    const value = robotPresetValue("detective");
    expect(notificationAvatarSource({ id: "b1", color: value, avatarSet: "robots" })).toBe(
      robotCharacterDataUri(listed("detective")),
    );
  });
});
