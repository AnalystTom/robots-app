// @vitest-environment jsdom

import {
  AVATAR_CLIP_POOLS,
  AVATAR_POKES,
  AVATAR_STILL_MAX_SIZE,
  avatarClip,
  avatarClipPose,
  avatarFrame,
  avatarPokeFrame,
} from "@robots/core";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityMark,
  MARK_SIZE,
  MARK_SPRING,
  ROW_HEIGHT,
  ROW_MS,
} from "../components/activity-mark";
import { BotAvatar } from "../components/bot-avatar";
import { AWAKE_MS, MORPH_SPRING } from "./avatar-life";

const CLOCK_MS = 24 * 60 * 60 * 1000;
const motion = vi.hoisted(() => ({
  reducedMotion: false,
  /** Every timing started: [target, duration]. */
  timings: [] as Array<[unknown, number]>,
  /** Every spring started: [target, config]. */
  springs: [] as Array<[unknown, Record<string, number> | undefined]>,
  cancelled: 0,
}));

vi.mock("react-native-reanimated", () => {
  const passthrough = ({ children, style }: { children?: ReactNode; style?: unknown }) =>
    createElement(
      "div",
      { "data-opacity": Object.assign({}, ...[style].flat()).opacity },
      children,
    );
  const easing = (value: unknown) => value;
  const fade = { duration: () => ({}) };
  return {
    default: { View: passthrough, createAnimatedComponent: () => passthrough },
    cancelAnimation: () => {
      motion.cancelled += 1;
    },
    Easing: { in: easing, out: easing, inOut: easing, quad: 0, cubic: 0, linear: 0 },
    FadeIn: fade,
    FadeOut: fade,
    ReduceMotion: { Never: "never" },
    useAnimatedProps: (worklet: () => unknown) => worklet(),
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    useReducedMotion: () => motion.reducedMotion,
    useSharedValue: <T,>(value: T) => useRef({ value }).current,
    withSpring: (value: unknown, config?: Record<string, number>) => {
      motion.springs.push([value, config]);
      return value;
    },
    withTiming: (value: unknown, config?: { duration?: number }) => {
      motion.timings.push([value, config?.duration ?? 0]);
      return value;
    },
  };
});
vi.mock("react-native-svg", () => {
  const element = ({ children, fill }: { children?: ReactNode; fill?: string }) =>
    createElement("div", { "data-fill": fill }, children);
  return {
    default: element,
    Ellipse: element,
    G: element,
    Path: element,
    Rect: element,
    SvgXml: element,
  };
});
vi.mock("react-native", () => ({
  View: ({
    children,
    accessibilityLabel,
    style,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    style?: { width?: number; backgroundColor?: string; borderColor?: string };
  }) =>
    createElement(
      "div",
      {
        "aria-label": accessibilityLabel,
        "data-width": style?.width,
        "data-bg": style?.backgroundColor,
        "data-ring": style?.borderColor,
      },
      children,
    ),
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  Image: () => null,
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("./native", () => ({
  useMobileTokens: () => ({
    mutedForeground: "#888",
    background: "#FFF",
    workingDot: "#3FA266",
    secondary: "#EEE",
  }),
}));

const SHAPE = "#2A92FE::shape_2";

describe("avatar motion on mobile", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    motion.reducedMotion = false;
    motion.timings = [];
    motion.springs = [];
    motion.cancelled = 0;
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const render = (node: ReactNode) => act(() => root.render(node));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const clockStarted = () => motion.timings.some(([, duration]) => duration === CLOCK_MS);
  /** The last wake-up target: 1 moving, 0 still or only blinking. */
  const awake = () =>
    motion.timings
      .filter(([target, duration]) => duration === AWAKE_MS && (target === 0 || target === 1))
      .at(-1)?.[0];
  const workingDot = () => container.querySelector('[aria-label="Working"]');

  it("keeps a resting inbox avatar a still picture: no clock, no blink", () => {
    render(<BotAvatar color={SHAPE} identity="bot-1" size={62} motion="lazy" />);
    wait(30_000);
    expect(clockStarted()).toBe(false);
  });

  it("keeps every other avatar still, even while its bot works, and keeps the working dot", () => {
    render(<BotAvatar color={SHAPE} identity="bot-1" size={28} status="running" />);
    wait(30_000);
    expect(clockStarted()).toBe(false);
    expect(workingDot()).not.toBeNull();
  });

  it("draws the working dot as a green disc ringed in the surface colour, sized for the avatar", () => {
    render(<BotAvatar color={SHAPE} identity="bot-1" size={62} status="running" motion="lazy" />);
    expect(workingDot()?.getAttribute("data-bg")).toBe("#3FA266");
    expect(workingDot()?.getAttribute("data-ring")).toBe("#FFF");
    expect(Number(workingDot()?.getAttribute("data-width"))).toBeCloseTo(12 + 2 * 62 * 0.046);
    render(<BotAvatar color={SHAPE} identity="bot-1" size={28} status="running" />);
    expect(Number(workingDot()?.getAttribute("data-width"))).toBeCloseTo(10 + 2 * 28 * 0.046);
  });

  it("rests a bot waiting on you: no motion, no working dot", () => {
    render(
      <BotAvatar color={SHAPE} identity="bot-1" size={62} status="waiting_input" motion="lazy" />,
    );
    expect(clockStarted()).toBe(false);
    expect(workingDot()).toBeNull();
  });

  it("drops the chat header's working dot while the bot writes, and keeps it a still picture", () => {
    render(<BotAvatar color={SHAPE} identity="bot-1" size={28} status="running" composing />);
    expect(workingDot()).toBeNull();
    expect(clockStarted()).toBe(false);
    expect(motion.springs.at(-1)?.[0]).toBe(0);
  });

  it("leaves the working dot off the chat's working avatar, which is the sign itself", () => {
    render(
      <BotAvatar color={SHAPE} identity="bot-1" size={28} status="running" motion="running" />,
    );
    expect(workingDot()).toBeNull();
    render(
      <BotAvatar
        color={SHAPE}
        identity="bot-1"
        size={28}
        status="running"
        motion="running"
        composing
      />,
    );
    expect(workingDot()).toBeNull();
  });

  it("keeps a writing bot's face under Reduce Motion instead of turning it into moving dots", () => {
    motion.reducedMotion = true;
    render(
      <BotAvatar
        color={SHAPE}
        identity="bot-1"
        size={28}
        status="running"
        motion="running"
        composing
      />,
    );
    expect(awake()).toBe(0);
    expect(motion.springs).not.toContainEqual([1, MORPH_SPRING]);
    expect(motion.springs.at(-1)?.[0]).toBe(0);
  });

  it("holds a photo's place with a plain circle while the photo loads", () => {
    render(<BotAvatar color="data:image/png;base64,AAAA" identity="bot-p" size={28} />);
    const circle = container.querySelector('[data-bg="#EEE"]');
    expect(circle?.getAttribute("data-width")).toBe("28");
  });

  it("keeps tiny and photo avatars still", () => {
    render(
      <>
        <BotAvatar
          color={SHAPE}
          identity="bot-1"
          size={AVATAR_STILL_MAX_SIZE}
          status="running"
          motion="lazy"
        />
        <BotAvatar
          color="data:image/png;base64,AAAA"
          identity="bot-2"
          size={62}
          status="running"
          motion="lazy"
        />
      </>,
    );
    expect(clockStarted()).toBe(false);
  });
});

describe("activity mark", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    motion.reducedMotion = false;
    motion.timings = [];
    motion.springs = [];
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const render = (node: ReactNode) => act(() => root.render(node));
  const bots = [
    { id: "bot-a", color: SHAPE, status: "running" },
    { id: "bot-b", color: "#FF781C", status: "running" },
  ];
  const grewIn = () => motion.springs.some(([, config]) => config === MARK_SPRING);

  it("opens its row and grows in only once the chat is at the newest message", () => {
    render(<ActivityMark bots={bots.slice(0, 1)} atBottom={false} />);
    expect(motion.timings).toContainEqual([ROW_HEIGHT, ROW_MS]);
    expect(grewIn()).toBe(false);
    render(<ActivityMark bots={bots.slice(0, 1)} atBottom />);
    expect(grewIn()).toBe(true);
  });

  it("holds still on the first member under Reduce Motion and appears at once", () => {
    motion.reducedMotion = true;
    render(<ActivityMark bots={bots} atBottom />);
    const first = container.innerHTML;
    act(() => vi.advanceTimersByTime(6000));
    expect(container.innerHTML).toBe(first);
    expect(grewIn()).toBe(false);
  });

  it("leaves room in its row for the highest hop on top of the biggest working move", () => {
    /** How far (points) a frame lifts the top of the mark: its move up plus half its stretch. */
    const lift = (translateY: number, scaleY: number) =>
      (-translateY + (scaleY - 1) / 2) * MARK_SIZE;
    let working = 0;
    for (const name of new Set(AVATAR_CLIP_POOLS.working)) {
      const clip = avatarClip(name);
      for (let t = 0; t <= clip.duration; t += 0.01) {
        const frame = avatarFrame(avatarClipPose(clip, t), 1);
        working = Math.max(working, lift(frame.translateY, frame.scaleY));
      }
    }
    let tap = 0;
    for (const poke of AVATAR_POKES)
      for (let p = 0; p <= 1; p += 0.005) {
        const frame = avatarPokeFrame(poke, p);
        tap = Math.max(tap, lift(frame.translateY, frame.scaleY));
      }
    expect(tap).toBeGreaterThan(3);
    expect(working + tap).toBeLessThanOrEqual((ROW_HEIGHT - MARK_SIZE) / 2);
  });

  it("stays tappable for its reaction (the poke curves are tested in core)", () => {
    render(<ActivityMark bots={bots.slice(0, 1)} atBottom />);
    const tap = () => act(() => container.querySelector("button")?.click());
    // Pokes land on the avatar's shared value; the button stays tappable throughout.
    tap();
    tap();
    tap();
    expect(container.querySelector("button")).not.toBeNull();
  });
});
