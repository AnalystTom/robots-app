// @vitest-environment jsdom

import { ROBOT_PRESETS, robotCharacterSvg } from "@robots/core";
import type { ColorTokens } from "@robots/ui-tokens";
import { tokensForAppearance } from "@robots/ui-tokens";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotAvatarProps } from "../components/bot-avatar";
import { BotAvatar } from "../components/bot-avatar";
import { AvatarScreenFocus } from "./avatar-life";
import { mobileLogoAvatarActivity } from "./logo-avatar-activity";

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
    Defs: element("defs"),
    ClipPath: element("clipPath"),
    Mask: element("mask"),
    LinearGradient: element("linearGradient"),
    RadialGradient: element("radialGradient"),
    Stop: element("stop"),
    SvgXml: ({ xml }: { xml: string }) => createElement("svgxml", { "data-xml": xml }),
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

describe("BotAvatar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    nativeProps.length = 0;
    nativeMotion.reduced = true;
    nativeMotion.styles.length = 0;
    nativeMotion.timings.length = 0;
    mobileLogoAvatarActivity.clear();
    mobileTokens.current = undefined;
  });

  function render(
    color: string,
    avatarSet?: "organic" | "robots",
    props: Partial<BotAvatarProps> = {},
    focused = true,
  ) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const avatar = (
      <BotAvatar color={color} avatarSet={avatarSet} identity="bot-1" size={42} {...props} />
    );
    act(() =>
      root?.render(
        focused ? (
          avatar
        ) : (
          <AvatarScreenFocus navigation={{ isFocused: () => false, addListener: () => () => {} }}>
            {avatar}
          </AvatarScreenFocus>
        ),
      ),
    );
    return container;
  }

  const bodies = (view: HTMLElement) =>
    Array.from(view.querySelectorAll("path"), (path) => path.dataset.d);

  it.each([
    ["a ghost-style colour", "#3EC5A8", "robots"],
    ["a plain colour in the original set", "#3EC5A8", "organic"],
    ["an organic shape", "#8B5CF6::shape_3", "robots"],
  ] as const)("draws %s as a preset robot picture", (_, color, avatarSet) => {
    const view = render(color, avatarSet);
    const robot = view.querySelector("svgxml")?.getAttribute("data-xml");
    const presets = ROBOT_PRESETS.map((preset) => robotCharacterSvg(preset.look));
    expect(presets).toContain(robot);
    expect(bodies(view)).toEqual([]);
    expect(view.querySelector("ellipse")).toBeNull();
    expect(render(color, avatarSet).querySelector("svgxml")?.getAttribute("data-xml")).toBe(robot);
  });

  it("keeps a picture", () => {
    const view = render("data:image/png;base64,abc");
    expect(view.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(bodies(view)).toEqual([]);
  });

  it("keeps a custom picture when the stored set is RoBots", () => {
    const view = render("data:image/png;base64,abc", "robots");
    expect(view.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(bodies(view)).toEqual([]);
  });

  it.each([
    ["light", "data:image/png;base64,abc"],
    ["dark", "data:image/png;base64,abc"],
    ["light", "#3EC5A8"],
    ["dark", "#3EC5A8"],
  ] as const)("draws the muted badge with the %s theme tokens for %s", (appearance, color) => {
    const tokens = tokensForAppearance(appearance);
    mobileTokens.current = tokens;
    const badge = render(color, undefined, { muted: true }).querySelector<HTMLElement>(
      '[aria-label="Notifications silenced"]',
    );
    // An opaque backing keeps the picture from showing through the translucent fill.
    expect(badge?.dataset).toMatchObject({
      border: tokens.background,
      background: tokens.background,
    });
    expect(badge?.querySelector<HTMLElement>("div")?.dataset.background).toBe(tokens.secondary);
    expect(badge?.querySelector("i")?.dataset.color).toBe(tokens.foreground);
  });
});
