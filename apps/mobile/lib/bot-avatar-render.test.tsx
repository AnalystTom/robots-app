// @vitest-environment jsdom

import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterSvg, robotPresetForIdentity, robotPresetValue } from "@robots/core";
import type { ColorTokens } from "@robots/ui-tokens";
import { tokensForAppearance } from "@robots/ui-tokens";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotAvatarProps } from "../components/bot-avatar";
import { BotAvatar } from "../components/bot-avatar";

const nativeProps = vi.hoisted(() => [] as Array<() => Record<string, unknown>>);
const mobileTokens = vi.hoisted(() => ({ current: undefined as ColorTokens | undefined }));
const nativeMotion = vi.hoisted(() => ({
  reduced: true,
  styles: [] as Array<() => { transform: unknown[] }>,
  timings: [] as number[],
}));

vi.mock("react-native", () => ({
  View: ({
    children,
    accessibilityLabel,
    style,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    style?: { borderColor?: string; backgroundColor?: string };
  }) =>
    createElement(
      "div",
      {
        "aria-label": accessibilityLabel,
        "data-border": style?.borderColor,
        "data-background": style?.backgroundColor,
      },
      children,
    ),
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
  Pressable: ({
    children,
    onPress,
    accessible,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessible?: boolean;
  }) =>
    createElement(
      "button",
      { type: "button", onClick: onPress, "data-accessible": String(accessible) },
      children,
    ),
  Image: ({ source }: { source: { uri: string } }) => createElement("img", { src: source.uri }),
}));

vi.mock("react-native-reanimated", () => {
  const passthrough = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    default: {
      View: passthrough,
      createAnimatedComponent: (component: unknown) => component,
    },
    cancelAnimation: () => undefined,
    Easing: { linear: (value: number) => value, inOut: (value: unknown) => value, cubic: 0 },
    ReduceMotion: { Never: "never" },
    withSpring: (value: unknown) => value,
    useAnimatedProps: (sample: () => Record<string, unknown>) => {
      nativeProps.push(sample);
      return {};
    },
    useDerivedValue: (sample: () => unknown) => ({ value: sample() }),
    useAnimatedStyle: (sample: () => { transform: unknown[] }) => {
      nativeMotion.styles.push(sample);
      return {};
    },
    useReducedMotion: () => nativeMotion.reduced,
    useSharedValue: <T,>(value: T) => useRef({ value }).current,
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown, options?: { duration: number }) => {
      const duration = options?.duration ?? 0;
      nativeMotion.timings.push(duration);
      return value === 1 && duration > 0 && duration < 1000 ? 0.4 : value;
    },
  };
});

vi.mock("react-native-svg", () => {
  const element =
    (tag: string) =>
    ({
      children,
      ...props
    }: {
      children?: ReactNode;
      d?: string;
      fill?: string;
      stopColor?: string;
    }) =>
      createElement(
        tag,
        { "data-d": props.d, "data-fill": props.fill, "data-stop-color": props.stopColor },
        children,
      );
  return {
    default: element("svg"),
    Ellipse: element("ellipse"),
    G: element("g"),
    Path: element("path"),
    Rect: element("rect"),
    SvgXml: ({ xml }: { xml: string }) => createElement("svg", { "data-xml": xml }),
    Defs: element("defs"),
    ClipPath: element("clipPath"),
    Mask: element("mask"),
    LinearGradient: element("linearGradient"),
    RadialGradient: element("radialGradient"),
    Stop: element("stop"),
  };
});

vi.mock("../components/native-symbol", () => ({
  NativeSymbol: ({ color }: { color: string }) => createElement("i", { "data-color": color }),
}));
vi.mock("./native", () => ({
  useMobileTokens: () =>
    mobileTokens.current ?? {
      background: "#FFF",
      foreground: "#141414",
      sidebar: "#F1F1F1",
      border: "#CCCCCC",
      workingDot: "#3FA266",
      secondary: "#7676801F",
    },
}));

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  mobileTokens.current = undefined;
});

function render(color: string, props: Partial<BotAvatarProps> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(BotAvatar, { color, identity: "bot-1", ...props })));
  return container;
}

function drawnXml(view: HTMLElement): string[] {
  return Array.from(view.querySelectorAll("svg"), (node) => node.dataset.xml ?? "");
}

describe("BotAvatar", () => {
  const preset = robotPresetValue(robotPresetForIdentity("bot-1"));

  it.each([
    ["a plain hex", "#3EC5A8", "organic"],
    ["a plain hex under the robots set", "#3EC5A8", "robots"],
    ["an empty colour", "", "robots"],
    ["an organic shape", "#8B5CF6::shape_3", "organic"],
    ["an organic shape under the robots set", "#8B5CF6::shape_3", "robots"],
  ] as const)(
    "draws %s as the RoBots preset its identity hashes to",
    (_label, color, avatarSet) => {
      const view = render(color, { avatarSet });
      expect(drawnXml(view)).toEqual([robotCharacterSvg(parseRobotCharacter(preset)!)]);
      expect(view.querySelector("ellipse, path, rect, radialGradient")).toBeNull();
    },
  );

  it("keeps a picture", () => {
    const view = render("data:image/png;base64,abc");
    expect(view.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(drawnXml(view)).toEqual([]);
  });

  it("keeps a robot the bot wears", () => {
    const worn = robotPresetValue("detective");
    const view = render(worn, { avatarSet: "robots" });
    expect(drawnXml(view)).toEqual([robotCharacterSvg(parseRobotCharacter(worn)!)]);
  });

  it.each([
    ["light", "data:image/png;base64,abc"],
    ["dark", "data:image/png;base64,abc"],
    ["light", "#3EC5A8"],
    ["dark", "#3EC5A8"],
  ] as const)("draws the muted badge with the %s theme tokens for %s", (appearance, color) => {
    const tokens = tokensForAppearance(appearance);
    mobileTokens.current = tokens;
    const badge = render(color, { muted: true }).querySelector<HTMLElement>(
      '[aria-label="Notifications silenced"]',
    );
    expect(badge?.dataset).toMatchObject({
      border: tokens.background,
      background: tokens.background,
    });
    expect(badge?.querySelector<HTMLElement>("div")?.dataset.background).toBe(tokens.secondary);
    expect(badge?.querySelector("i")?.dataset.color).toBe(tokens.foreground);
  });
});
