// @vitest-environment jsdom
import { robotCharacterValue } from "@robots/contracts";
import { LOGO_BODY_PATH, robotCharacterSvg } from "@robots/core";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NewBot from "../app/new-bot";

const CHARACTERS = [
  {
    name: "Assistant",
    look: { colour: "green", headwear: "antenna", face: "happy", outfit: "vest", extra: "none" },
  },
  {
    name: "Researcher",
    look: {
      colour: "blue",
      headwear: "deerstalker",
      face: "magnifier",
      outfit: "tweed",
      extra: "none",
    },
  },
  {
    name: "Coder",
    look: { colour: "teal", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  },
  {
    name: "Writer",
    look: {
      colour: "purple",
      headwear: "mortarboard",
      face: "glasses",
      outfit: "turtleneck",
      extra: "none",
    },
  },
  {
    name: "Analyst",
    look: {
      colour: "slate",
      headwear: "top-hat",
      face: "monocle",
      outfit: "tuxedo",
      extra: "none",
    },
  },
  {
    name: "Creator",
    look: {
      colour: "pink",
      headwear: "antenna",
      face: "hearts",
      outfit: "t-shirt",
      extra: "ring-light",
    },
  },
  {
    name: "Chef",
    look: {
      colour: "orange",
      headwear: "chef-hat",
      face: "happy",
      outfit: "chef-jacket",
      extra: "steam",
    },
  },
  {
    name: "Hero",
    look: {
      colour: "red",
      headwear: "antenna",
      face: "aviators",
      outfit: "cape",
      extra: "confetti",
    },
  },
  {
    name: "Professor",
    look: {
      colour: "teal",
      headwear: "mortarboard",
      face: "monocle",
      outfit: "tweed",
      extra: "none",
    },
  },
  {
    name: "Detective",
    look: {
      colour: "purple",
      headwear: "deerstalker",
      face: "magnifier",
      outfit: "cape",
      extra: "none",
    },
  },
  {
    name: "Keynote",
    look: {
      colour: "slate",
      headwear: "antenna",
      face: "glasses",
      outfit: "turtleneck",
      extra: "none",
    },
  },
  {
    name: "Hustler",
    look: {
      colour: "orange",
      headwear: "antenna",
      face: "aviators",
      outfit: "vest",
      extra: "none",
    },
  },
  {
    name: "Host",
    look: {
      colour: "blue",
      headwear: "top-hat",
      face: "happy",
      outfit: "tuxedo",
      extra: "confetti",
    },
  },
  {
    name: "Critic",
    look: {
      colour: "red",
      headwear: "chef-hat",
      face: "grumpy",
      outfit: "chef-jacket",
      extra: "steam",
    },
  },
  {
    name: "Hoodie",
    look: { colour: "green", headwear: "hood", face: "terminal", outfit: "hoodie", extra: "none" },
  },
] as const;
const CHARACTER_NAMES = CHARACTERS.map((character) => character.name);

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
    if (path === "bots/list")
      return Promise.resolve([{ id: "existing-bot", userId: "user-other" }]);
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

it("shows every character and only those, draws the picked one in the preview, and creates it", async () => {
  serveRpc(() => Promise.resolve({ botAvatarSet: "robots" }));
  await render();

  for (const name of CHARACTER_NAMES) expect(radio(name)).not.toBeNull();
  const startedOn = CHARACTER_NAMES.findIndex(checked);
  expect(CHARACTER_NAMES.filter(checked)).toHaveLength(1);
  expect(previewXml()).toBe(robotCharacterSvg(CHARACTERS[startedOn]!.look));
  expect(drawsLogo()).toBe(false);

  for (const character of CHARACTERS) {
    await tap(radio(character.name));
    expect(CHARACTER_NAMES.filter(checked)).toEqual([character.name]);
    expect(previewXml()).toBe(robotCharacterSvg(character.look));
    expect(drawsLogo()).toBe(false);
  }

  const chef = CHARACTERS.find((character) => character.name === "Chef")!.look;
  await tap(radio("Chef"));
  expect(previewXml()).toBe(robotCharacterSvg(chef));
  expect(radio("Shuffle")).toBeNull();
  expect(radio("Color 2")).toBeNull();

  await typeName("Gordon");
  await tap(createButton());
  await vi.waitFor(() => expect(createdBot()).toBeDefined());
  expect(createdBot()).toEqual(
    expect.objectContaining({
      name: "Gordon",
      color: robotCharacterValue(chef),
      avatarSet: "robots",
    }),
  );
});

it("creates the robot the preview preselected, so the stored bot is the one shown", async () => {
  serveRpc(() => Promise.resolve({ botAvatarSet: "robots" }));
  await render();
  const startedOn = CHARACTER_NAMES.findIndex(checked);
  await typeName("Gordon");
  await tap(createButton());
  await vi.waitFor(() => expect(createdBot()).toBeDefined());
  expect(createdBot()).toEqual(
    expect.objectContaining({
      name: "Gordon",
      color: robotCharacterValue(CHARACTERS[startedOn]!.look),
    }),
  );
});

it("preselects the robot the user's own bots wear least, not one another member wears", async () => {
  const hero = CHARACTERS.find((character) => character.name === "Hero")!;
  const own = CHARACTERS.filter((character) => character.name !== "Hero").map((character) =>
    robotCharacterValue(character.look),
  );
  const bots = [
    ...own.map((color, index) => ({ id: `own-${index}`, userId: "user-me", color })),
    { id: "other-1", userId: "user-other", color: robotCharacterValue(hero.look) },
    { id: "other-2", userId: "user-other", color: robotCharacterValue(hero.look) },
  ];
  mocks.rpc.mockImplementation((path: string) => {
    if (path === "me") return Promise.resolve({ botAvatarSet: "robots", userId: "user-me" });
    if (path === "bots/list") return Promise.resolve(bots);
    return Promise.resolve(undefined);
  });
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    await render();
    expect(CHARACTER_NAMES.filter(checked)).toEqual(["Hero"]);
    await typeName("Gordon");
    await tap(createButton());
    await vi.waitFor(() => expect(createdBot()).toBeDefined());
    expect(createdBot()).toEqual(
      expect.objectContaining({
        name: "Gordon",
        color: "robot:red.antenna.aviators.cape.confetti",
      }),
    );
  } finally {
    random.mockRestore();
  }
});

it("sends a robot picked on an Original account with the RoBots set", async () => {
  serveRpc(() => Promise.resolve({ botAvatarSet: "organic" }));
  await render();
  await tap(radio("Hero"));
  await typeName("Gordon");
  await tap(createButton());
  await vi.waitFor(() => expect(createdBot()).toBeDefined());
  expect(createdBot()).toEqual(
    expect.objectContaining({
      name: "Gordon",
      color: "robot:red.antenna.aviators.cape.confetti",
      avatarSet: "robots",
    }),
  );
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

it("keeps Create on and sends the previewed robot when the bot list cannot load", async () => {
  mocks.rpc.mockImplementation((path: string) => {
    if (path === "me") return Promise.resolve({ botAvatarSet: "robots", userId: "user-me" });
    if (path === "bots/list") return Promise.reject(new Error("Bots unavailable"));
    if (path === "bots/create") return Promise.resolve({ id: "bot-1", name: "Gordon" });
    return Promise.resolve(undefined);
  });
  await render();
  const previewed = CHARACTER_NAMES.filter(checked);
  expect(previewed).toHaveLength(1);
  await typeName("Gordon");
  expect(container.textContent).not.toContain("Couldn't load your bot style.");
  expect(createButton().disabled).toBe(false);
  await tap(createButton());
  await vi.waitFor(() => expect(createdBot()).toBeDefined());
  const character = CHARACTERS.find((candidate) => candidate.name === previewed[0])!;
  expect(createdBot()).toEqual(
    expect.objectContaining({ color: robotCharacterValue(character.look) }),
  );
});
