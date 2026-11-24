import { BOT_COLORS } from "@robots/contracts";
import * as Notifications from "expo-notifications";
import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import BotSettingsScreen from "../app/bot-settings";

const mocks = vi.hoisted(() => ({
  instructions: "",
  description: "",
  crossSpaceCommunication: false,
  avatarSet: "organic" as "organic" | "robots",
  color: "",
  focus: undefined as string | undefined,
  os: "ios",
  work: [] as unknown[],
  history: [] as unknown[],
  share: vi.fn(),
  docs: [] as unknown[],
  fill: "light-fill",
  deviceVoices: vi.fn(),
  voiceForBot: vi.fn(),
  setVoiceForBot: vi.fn(),
  rpc: vi.fn(),
  loadBot: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  stopVoicePlayback: vi.fn(),
  stop: vi.fn(),
  speak: vi.fn(),
  alert: vi.fn(),
  prompt: vi.fn(),
  layouts: new WeakMap<
    HTMLElement,
    (event: { nativeEvent: { layout: { width: number } } }) => void
  >(),
}));
export const offered = [
  { identifier: "voice-a", name: "Alice", language: "en-US" },
  { identifier: "voice-b", name: "Beth", language: "en-GB" },
];

export function deferredSave<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolveSave, rejectSave) => {
    resolve = resolveSave;
    reject = rejectSave;
  });
  return { promise, resolve, reject };
}

vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./bot-voices", () => ({
  voiceLabel: (voice: { language: string; name: string }) => `${voice.name} (${voice.language})`,
  deviceVoices: mocks.deviceVoices,
  voiceForBot: mocks.voiceForBot,
  setVoiceForBot: mocks.setVoiceForBot,
}));
vi.mock("./device-voice", () => ({ loadDeviceVoiceEnabled: async () => true }));
vi.mock("./voice", () => ({ stopVoicePlayback: mocks.stopVoicePlayback }));
vi.mock("expo-speech", () => ({ stop: mocks.stop, speak: mocks.speak }));
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  currentApiBase: () => "https://api.example.test",
  selectedSpaceId: () => "space-a",
  rpc: async (procedure: string, input?: unknown) => {
    if (
      [
        "bots/update",
        "bots/setComputer",
        "scratchpad/create",
        "scratchpad/update",
        "bots/restoreInstructions",
        "export/bot",
        "threads/clear",
      ].includes(procedure)
    )
      return mocks.rpc(procedure, input);
    if (procedure === "bots/get") {
      await mocks.loadBot();
      return {
        id: "bot-fixture",
        threadId: "thread-fixture",
        name: "Fixture",
        title: "",
        instructions: mocks.instructions,
        description: mocks.description,
        instructionHistory: mocks.history,
        color: mocks.color,
        avatarSet: mocks.avatarSet,
        autoSpeak: false,
        computerMode: "team",
        fleetManagement: false,
        crossSpaceCommunication: mocks.crossSpaceCommunication,
      };
    }
    if (procedure === "scratchpad/list") return mocks.work;
    if (procedure === "memory/list") return mocks.docs;
    if (procedure === "me") return {};
    return [];
  },
}));
vi.mock("./session", () => ({
  loadSessionToken: async () => "token",
}));
vi.mock("./live-notifications", { spy: true });
vi.mock("expo-modules-core", () => ({ requireNativeModule: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("expo-notifications", () => ({
  getPresentedNotificationsAsync: vi.fn(async () => []),
  dismissNotificationAsync: vi.fn(async () => undefined),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mocks.back, push: mocks.push }),
  useLocalSearchParams: () => ({ botId: "bot-fixture", focus: mocks.focus }),
  useFocusEffect: (effect: () => (() => void) | undefined) => useEffect(effect, [effect]),
}));
vi.mock("react-native", () => {
  const view = ({
    children,
    style,
    accessibilityLabel,
    accessibilityRole,
    accessibilityValue,
    onLayout,
  }: {
    children?: ReactNode;
    style?: unknown;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityValue?: { text: string };
    onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
  }) =>
    createElement(
      "div",
      {
        "data-style": JSON.stringify(style),
        "aria-label": accessibilityLabel,
        role: accessibilityRole,
        "aria-valuetext": accessibilityValue?.text,
        ref: (element: HTMLElement | null) => {
          if (element && onLayout) mocks.layouts.set(element, onLayout);
        },
      },
      children,
    );
  return {
    Alert: { alert: mocks.alert, prompt: mocks.prompt },
    Share: { share: mocks.share },
    Platform: {
      get OS() {
        return mocks.os;
      },
    },
    useWindowDimensions: () => ({ fontScale: 1 }),
    StyleSheet: { create: (styles: unknown) => styles },
    Modal: view,
    ScrollView: view,
    View: view,
    Text: ({
      children,
      style,
      accessibilityRole,
      allowFontScaling,
    }: {
      children?: ReactNode;
      style: unknown;
      accessibilityRole?: string;
      allowFontScaling?: boolean;
    }) =>
      createElement(
        "span",
        {
          "data-style": JSON.stringify(style),
          role: accessibilityRole,
          "data-font-scaling": allowFontScaling ?? true,
        },
        children,
      ),
    TextInput: ({
      style,
      accessibilityLabel,
      placeholder,
      multiline,
      value,
      onChangeText,
      scrollEnabled,
      editable,
    }: {
      value: string;
      onChangeText?: (value: string) => void;
      scrollEnabled?: boolean;
      editable?: boolean;
      style?: unknown;
      accessibilityLabel?: string;
      placeholder?: string;
      multiline?: boolean;
    }) =>
      createElement("textarea", {
        value,
        disabled: editable === false,
        onChange: () => undefined,
        onInput: (event: { currentTarget: HTMLTextAreaElement }) =>
          onChangeText?.(event.currentTarget.value),
        "data-scroll-enabled": scrollEnabled,
        "data-style": JSON.stringify(style),
        "aria-label": accessibilityLabel,
        "aria-multiline": multiline,
        placeholder,
      }),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole,
      accessibilityState,
      style,
      hitSlop,
    }: {
      children?: ReactNode;
      onPress: () => void;
      accessibilityLabel?: string;
      accessibilityHint?: string;
      accessibilityRole?: string;
      accessibilityState?: { expanded?: boolean; checked?: boolean };
      style?: unknown;
      hitSlop?: number;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          onClick: onPress,
          "aria-label": accessibilityLabel,
          "data-hint": accessibilityHint,
          role: accessibilityRole,
          "aria-expanded": accessibilityState?.expanded,
          "data-checked": accessibilityState?.checked,
          "data-style": JSON.stringify(style),
          "data-hit-slop": hitSlop,
        },
        children,
      ),
  };
});
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./native", () => ({
  native: {
    secondaryLabel: "muted",
    tertiaryLabel: "muted",
    get fill() {
      return mocks.fill;
    },
  },
  useMobileTokens: () => ({ mutedForeground: "muted", foreground: "ink", destructive: "error" }),
  useResolvedAppearance: () => "light",
  useThemedStyles: (createStyles: () => unknown) => createStyles(),
}));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/native-segmented-control", () => ({
  NativeSegmentedControl: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) =>
    options.map((option) =>
      createElement(
        "button",
        { type: "button", key: option.value, onClick: () => onChange(option.value) },
        option.label,
      ),
    ),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { type: "button", onClick: onPress, disabled }, label),
}));
vi.mock("../components/native-switch", () => ({
  NativeSwitch: ({
    accessibilityLabel,
    onValueChange,
    value,
    disabled,
  }: {
    accessibilityLabel: string;
    onValueChange: (value: boolean) => void;
    value: boolean;
    disabled?: boolean;
  }) =>
    createElement("button", {
      type: "button",
      "aria-label": accessibilityLabel,
      role: "switch",
      "aria-checked": value,
      disabled,
      onClick: () => onValueChange(!value),
    }),
}));
vi.mock("../components/native-symbol", () => ({
  NativeSymbol: ({ ios, android }: { ios: string; android: string }) =>
    createElement("i", { "data-ios": ios, "data-android": android }),
}));
vi.mock("@expo/ui/community/menu", () => ({
  MenuView: ({
    title,
    actions,
    onPressAction,
    children,
    style,
  }: {
    title: string;
    actions: { id: string; title: string; state: string }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    children: ReactNode;
    style?: unknown;
  }) =>
    createElement(
      "section",
      { "data-menu": title, "data-style": JSON.stringify(style) },
      children,
      ...actions.map((action) =>
        createElement(
          "button",
          {
            type: "button",
            key: action.id,
            "data-state": action.state,
            onClick: () => onPressAction({ nativeEvent: { event: action.id } }),
          },
          action.title,
        ),
      ),
    ),
}));

export function mountBotSettings() {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    mocks.crossSpaceCommunication = false;
    mocks.avatarSet = "organic";
    mocks.color = BOT_COLORS[0]!;
    vi.clearAllMocks();
    mocks.loadBot.mockReset();
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([]);
    mocks.focus = undefined;
    mocks.instructions = "";
    mocks.description = "";
    mocks.os = "ios";
    mocks.work = [];
    mocks.history = [];
    mocks.docs = [];
    mocks.fill = "light-fill";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.deviceVoices.mockResolvedValue(offered);
    mocks.voiceForBot.mockResolvedValue("voice-a");
    mocks.setVoiceForBot.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
  const expand = async () =>
    act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Advanced"]')!.click());
  return {
    get container() {
      return container;
    },
    get root() {
      return root;
    },
    expand,
    async render() {
      await act(async () => root.render(<BotSettingsScreen />));
      await expand();
    },
    menu: () => container.querySelector('[data-menu="Device voice"]'),
    remount() {
      act(() => root.unmount());
      root = createRoot(container);
    },
  };
}

export { mocks };
