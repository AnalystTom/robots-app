// @vitest-environment jsdom
import { robotPresetValue } from "@robots/core";
import type { ReactNode } from "react";
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotLookPicker } from "../components/bot-look-picker";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }) };
});
vi.mock("@lingui/core/macro", () => ({
  ph: ({ number }: { number: number }) => number,
  t: (parts: TemplateStringsArray) => parts.join(""),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Text = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  const Pressable = ({
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    disabled,
    onPress,
    children,
  }: {
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { checked?: boolean };
    disabled?: boolean;
    onPress?: () => void;
    children?: ReactNode;
  }) => (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the stub renders whichever radio role the picker passes
    <button
      type="button"
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-checked={accessibilityState?.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
  return {
    View,
    Text,
    Pressable,
    AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
    Appearance: {
      getColorScheme: () => "light",
      addChangeListener: () => ({ remove: () => undefined }),
    },
    Platform: {
      OS: "ios",
      select: <T,>(options: { ios?: T; default?: T }) => options.ios ?? options.default,
    },
    PlatformColor: (...names: string[]) => names[0],
  };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
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
    useAnimatedProps: () => ({}),
    useDerivedValue: (sample: () => unknown) => ({ value: sample() }),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: <T,>(value: T) => ({ value }),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});
vi.mock("react-native-svg", () => {
  const element =
    (tag: string) =>
    ({ children, ...props }: { children?: ReactNode; d?: string }) =>
      createElement(tag, { "data-d": props.d }, children);
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
    SvgXml: element("svg"),
  };
});
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("@react-native-vector-icons/ionicons", () => ({ default: () => null }));
vi.mock("@react-native-vector-icons/material-design-icons", () => ({
  MaterialDesignIcons: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn<(value: string) => void>();

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <BotLookPicker
      value={value}
      avatarSet="robots"
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function findRadio(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (node) => node.getAttribute("aria-label") === label,
  );
}
function radio(label: string) {
  const found = findRadio(label);
  if (!found) throw new Error(`Missing radio ${label}`);
  return found;
}
async function render(value: string) {
  await act(async () => root.render(<Harness initial={value} />));
}

it("shows a stored look that is not a preset as the current look until a preset is tapped", async () => {
  await render("robot:pink.hood.happy.vest.none");
  expect(radio("Current look").getAttribute("aria-checked")).toBe("true");
  expect(radio("Assistant").getAttribute("aria-checked")).toBe("false");
  expect(changed).not.toHaveBeenCalled();

  await act(async () => radio("Assistant").click());
  expect(changed).toHaveBeenLastCalledWith(robotPresetValue("assistant"));
  expect(findRadio("Current look")).toBeUndefined();
  expect(radio("Assistant").getAttribute("aria-checked")).toBe("true");
});

it("does not add a current look tile for a ready-made preset", async () => {
  await render(robotPresetValue("assistant"));
  expect(findRadio("Current look")).toBeUndefined();
  expect(radio("Assistant").getAttribute("aria-checked")).toBe("true");
});
