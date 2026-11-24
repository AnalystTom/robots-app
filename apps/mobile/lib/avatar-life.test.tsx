// @vitest-environment jsdom

import {
  AVATAR_CLIP_POOLS,
  AVATAR_POKES,
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

const _CLOCK_MS = 24 * 60 * 60 * 1000;
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
