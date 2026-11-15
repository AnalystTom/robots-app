import type { RobotLook } from "@robots/contracts";
import { isBotAvatarValue, ROBOT_PARTS, robotCharacterValue } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { notificationAvatarSource } from "./notification-avatar.js";
import {
  READY_MADE_ROBOTS,
  randomRobotCharacterValue,
  randomRobotLook,
  readyMadeRobotValue,
  robotCharacterDataUri,
  robotCharacterSvg,
} from "./robot-character.js";

function* everyLook(): Generator<RobotLook> {
  for (const colour of ROBOT_PARTS.colour)
    for (const headwear of ROBOT_PARTS.headwear)
      for (const face of ROBOT_PARTS.face)
        for (const outfit of ROBOT_PARTS.outfit)
          for (const extra of ROBOT_PARTS.extra) yield { colour, headwear, face, outfit, extra };
}

describe("robotCharacterSvg", () => {
  it("draws a standalone 256x256 document with the colour's backdrop first", () => {
    const svg = robotCharacterSvg(READY_MADE_ROBOTS.host);
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
      // Every opened element is closed or self-closing.
      const opened = svg.match(/<[a-zA-Z]/g)?.length ?? 0;
      const selfClosed = svg.match(/\/>/g)?.length ?? 0;
      const closed = svg.match(/<\/[a-zA-Z]+>/g)?.length ?? 0;
      expect(opened).toBe(selfClosed + closed);
    }
    expect(count).toBe(8 * 6 * 8 * 8 * 4);
  });

  it("drops the ears under the hood and lights the antenna in the colour's glow", () => {
    expect(robotCharacterSvg(READY_MADE_ROBOTS.hoodie)).not.toContain('x="44" y="108"');
    expect(robotCharacterSvg(READY_MADE_ROBOTS.keynote)).toContain('x="44" y="108"');
    expect(robotCharacterSvg(READY_MADE_ROBOTS.hustler)).toContain('fill="#fde68a"');
  });

  it("layers the parts back to front", () => {
    const svg = robotCharacterSvg(READY_MADE_ROBOTS.chef);
    const order = [
      'fill="#D9483B"', // backdrop
      'fill="#f8fafc"', // chef's jacket
      'fill="#a9b8c6"', // neck
      'fill="#1f2a44"', // collar
      'fill="#c3cfda"', // ears
      'stroke="#fff"', // steam
      'fill="#f1f5f8"', // head
      'stroke="#ff7a66"', // grumpy face
      'fill="#fff"><circle', // chef's hat
    ].map((marker) => svg.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("encodes a data URI once per look", () => {
    const uri = robotCharacterDataUri(READY_MADE_ROBOTS.professor);
    expect(uri.startsWith("data:image/svg+xml,%3Csvg")).toBe(true);
    expect(robotCharacterDataUri({ ...READY_MADE_ROBOTS.professor })).toBe(uri);
  });

  it("is the notification portrait for a robot bot", () => {
    const value = readyMadeRobotValue("detective");
    expect(notificationAvatarSource({ id: "b1", color: value, avatarSet: "robots" })).toBe(
      robotCharacterDataUri(READY_MADE_ROBOTS.detective),
    );
  });
});

describe("random robots", () => {
  it("are valid values with no extra, and vary", () => {
    const values = new Set<string>();
    for (let index = 0; index < 40; index++) {
      const value = randomRobotCharacterValue();
      expect(isBotAvatarValue(value)).toBe(true);
      expect(value.endsWith(".none")).toBe(true);
      values.add(value);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it("keep a requested colour", () => {
    expect(randomRobotLook(() => 0.99, "red")).toEqual({
      colour: "red",
      headwear: "top-hat",
      face: "happy",
      outfit: "tuxedo",
      extra: "none",
    });
  });

  it("ready-made keys are valid values", () => {
    for (const key of Object.keys(READY_MADE_ROBOTS) as (keyof typeof READY_MADE_ROBOTS)[]) {
      expect(isBotAvatarValue(readyMadeRobotValue(key))).toBe(true);
      expect(readyMadeRobotValue(key)).toBe(robotCharacterValue(READY_MADE_ROBOTS[key]));
    }
  });
});
