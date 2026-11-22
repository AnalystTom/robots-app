// @vitest-environment jsdom
import { ROBOT_PARTS, robotCharacterValue } from "@robots/contracts";
import { LOGO_BODY_PATH, ROBOT_PRESETS, robotCharacterSvg, withRobotPart } from "@robots/core";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NewBot from "../app/new-bot";

const CHARACTER_NAMES = [
  "Assistant",
  "Researcher",
  "Coder",
  "Writer",
  "Analyst",
  "Creator",
  "Chef",
  "Hero",
  "Professor",
  "Detective",
  "Keynote",
  "Hustler",
  "Host",
  "Critic",
];

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  router: { back: vi.fn(), dismiss: vi.fn(), push: vi.fn() },
}));

vi.mock("./api", () => ({
  rpc: mocks.rpc,
  captureApiRequestContext: async () => ({}),
  currentApiBase: () => "https://robots.test",
  selectedSpaceId: () => undefined,
  spaceSelectionSeq: () => 0,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  router: mocks.router,
  useLocalSearchParams: () => ({}),
  useRouter: () => mocks.router,
}));
vi.mock("expo-haptics", () => ({
  AndroidHaptics: {
    Clock_Tick: 0,
    Confirm: 1,
    Context_Click: 2,
    Segment_Tick: 3,
  },
  ImpactFeedbackStyle: { Light: 0 },
  NotificationFeedbackType: { Success: 0 },
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  performAndroidHapticsAsync: async () => undefined,
  selectionAsync: async () => undefined,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-modules-core", () => ({
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
}));
vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  getPermissionsAsync: async () => ({ status: "undetermined" }),
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("@react-native-vector-icons/ionicons", () => ({ default: () => null }));
vi.mock("@react-native-vector-icons/material-design-icons", () => ({
  MaterialDesignIcons: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("react-native", () => {
  const View = ({
    children,
    accessibilityRole,
  }: {
    children?: ReactNode;
    accessibilityRole?: string;
  }) => <div role={accessibilityRole}>{children}</div>;
  return {
    ActivityIndicator: () => null,
    Alert: { alert: () => undefined },
    AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
    Appearance: {
      addChangeListener: () => ({ remove: () => undefined }),
      getColorScheme: () => "light",
      setColorScheme: () => undefined,
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    Platform: {
      OS: "android",
      Version: 34,
      select: <T,>(options: { android?: T }) => options.android,
    },
    PlatformColor: (name: string) => name,
    ScrollView: View,
    View,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Image: ({ source }: { source: { uri: string } }) => createElement("img", { src: source.uri }),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
    }: {
      accessibilityLabel: string;
      value: string;
      onChangeText: (text: string) => void;
    }) => (
      <input
        aria-label={accessibilityLabel}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ),
    Pressable: ({
      children,
      accessibilityRole,
      accessibilityLabel,
      accessibilityState,
      disabled,
      onPress,
    }: {
      children?: ReactNode;
      accessibilityRole?: string;
      accessibilityLabel?: string;
      accessibilityState?: { checked?: boolean };
      disabled?: boolean;
      onPress: () => void;
    }) => (
      <button
        type="button"
        data-role={accessibilityRole}
        data-checked={accessibilityState?.checked}
        aria-label={accessibilityLabel}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
  };
});
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
    useSharedValue: <T,>(value: T) => useRef({ value }).current,
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
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
    SvgXml: ({ xml, width }: { xml: string; width: number }) =>
      createElement("svg-xml", { "data-xml": xml, "data-width": String(width) }),
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
  };
});

function serveRpc(me: () => Promise<unknown>) {
  mocks.rpc.mockImplementation((path: string) => {
    if (path === "me") return me();
    if (path === "bots/list") return Promise.resolve([{ id: "existing-bot" }]);
    if (path === "bots/create") return Promise.resolve({ id: "bot-1", name: "Gordon" });
    return Promise.resolve(undefined);
  });
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function render() {
  await act(async () => root.render(<NewBot />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const radio = (name: string) =>
  container.querySelector<HTMLButtonElement>(`[data-role="radio"][aria-label="${name}"]`);
const checked = (name: string) => radio(name)?.dataset.checked === "true";
const previewXml = () =>
  container.querySelector<HTMLElement>('svg-xml[data-width="96"]')?.dataset.xml;
const drawsLogo = () =>
  [...container.querySelectorAll<HTMLElement>("path")].some(
    (path) => path.dataset.d === LOGO_BODY_PATH,
  );
const buttonLabelled = (label: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
const createButton = () => buttonLabelled("Create");
const tryAgainButton = () => buttonLabelled("Try again");
async function tap(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}
async function typeName(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function createdBot() {
  return mocks.rpc.mock.calls.find(([path]) => path === "bots/create")?.[1];
}

it("shows every character, draws the picked one recoloured in the preview, and creates it", async () => {
  serveRpc(() => Promise.resolve({ botAvatarSet: "robots" }));
  await render();

  for (const name of CHARACTER_NAMES) expect(radio(name)).not.toBeNull();
  const startedOn = CHARACTER_NAMES.findIndex(checked);
  expect(CHARACTER_NAMES.filter(checked)).toHaveLength(1);
  expect(previewXml()).toBe(robotCharacterSvg(ROBOT_PRESETS[startedOn]!.look));

  for (const [index, name] of CHARACTER_NAMES.entries()) {
    await tap(radio(name));
    expect(CHARACTER_NAMES.filter(checked)).toEqual([name]);
    expect(previewXml()).toBe(robotCharacterSvg(ROBOT_PRESETS[index]!.look));
    expect(drawsLogo()).toBe(false);
  }

  const chef = ROBOT_PRESETS.find((preset) => preset.id === "chef")!.look;
  const redChef = robotCharacterValue(withRobotPart(chef, "colour", ROBOT_PARTS.colour[1]));
  await tap(radio("Chef"));
  await tap(radio("Color 2"));
  expect(previewXml()).toBe(
    robotCharacterSvg(withRobotPart(chef, "colour", ROBOT_PARTS.colour[1])),
  );
  expect(drawsLogo()).toBe(false);
  expect(checked("Chef")).toBe(true);
  expect(checked("Color 2")).toBe(true);

  await typeName("Gordon");
  await tap(createButton());
  await vi.waitFor(() => expect(createdBot()).toBeDefined());
  expect(createdBot()).toEqual(expect.objectContaining({ name: "Gordon", color: redChef }));
});

it("keeps Create off until the account's bot style is known", async () => {
  let answer!: (me: { botAvatarSet: string }) => void;
  serveRpc(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await render();
  await typeName("Gordon");
  expect(radio("Shape 1")).not.toBeNull();
  expect(createButton().disabled).toBe(true);

  await act(async () => answer({ botAvatarSet: "robots" }));
  expect(radio("Shape 1")).toBeNull();
  expect(createButton().disabled).toBe(false);
});

it("says the bot style could not load, and offers a retry, when the account read fails", async () => {
  serveRpc(() => Promise.reject(new Error("Account unavailable")));
  await render();
  await typeName("Gordon");
  expect(container.textContent).toContain("Couldn't load your bot style.");
  expect(container.textContent).not.toContain("Account unavailable");
  expect(createButton().disabled).toBe(true);
  expect(tryAgainButton()).toBeDefined();
});

it("enables Create once a retry reads the account's bot style", async () => {
  const me = vi
    .fn()
    .mockRejectedValueOnce(new Error("Account unavailable"))
    .mockResolvedValue({ botAvatarSet: "robots" });
  serveRpc(me);
  await render();
  await typeName("Gordon");
  expect(createButton().disabled).toBe(true);

  await tap(tryAgainButton());
  expect(container.textContent).not.toContain("Couldn't load your bot style.");
  expect(createButton().disabled).toBe(false);
});
