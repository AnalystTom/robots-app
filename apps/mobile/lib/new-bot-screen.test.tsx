// @vitest-environment jsdom
import { ROBOT_PARTS, robotCharacterValue } from "@robots/contracts";
import { ROBOT_PRESETS, robotPresetValue, usesLogoAvatar, withRobotPart } from "@robots/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NewBot from "../app/new-bot";
import { errorText } from "./user-error";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createInboxBot: vi.fn(),
  router: { back: vi.fn(), dismiss: vi.fn(), push: vi.fn() },
}));

vi.mock("./api", () => ({ rpc: mocks.rpc }));
vi.mock("./create-inbox-bot", () => ({
  askForModelBeforeFirstBot: async () => false,
  createInboxBot: mocks.createInboxBot,
}));
vi.mock("./inbox-changes", () => ({ openChatFromInbox: () => true }));
vi.mock("./native", () => ({ native: {}, useMobileTokens: () => ({}) }));
vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("../components/sheet-header", () => ({ cancelHeaderOptions: () => ({}) }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/bot-avatar", () => ({
  BotAvatar: ({ color, avatarSet, size }: { color: string; avatarSet?: string; size?: number }) => (
    <i data-size={size} data-color={color} data-set={avatarSet ?? ""} />
  ),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => mocks.router,
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
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    ScrollView: View,
    View,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
      accessibilityLabel: string;
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

const PRESET_NAMES = [
  "Assistant",
  "Researcher",
  "Coder",
  "Writer",
  "Analyst",
  "Creator",
  "Chef",
  "Hero",
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.createInboxBot.mockResolvedValue("created");
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
const preview = () => container.querySelector<HTMLElement>('[data-size="96"]')!;
const createButton = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Create")!;
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

it("picks any preset robot, recolours it, and creates the bot the preview shows", async () => {
  mocks.rpc.mockResolvedValue({ botAvatarSet: "robots" });
  await render();

  for (const name of PRESET_NAMES) expect(radio(name)).not.toBeNull();
  const startedOn = PRESET_NAMES.filter(checked);
  expect(startedOn).toHaveLength(1);
  expect(preview().dataset.color).toBe(
    robotPresetValue(ROBOT_PRESETS[PRESET_NAMES.indexOf(startedOn[0]!)]!.id),
  );

  for (const [index, name] of PRESET_NAMES.entries()) {
    await tap(radio(name));
    expect(PRESET_NAMES.filter(checked)).toEqual([name]);
    expect(preview().dataset.color).toBe(robotPresetValue(ROBOT_PRESETS[index]!.id));
  }

  await tap(radio("Chef"));
  const chef = ROBOT_PRESETS.find((preset) => preset.id === "chef")!.look;
  const redChef = robotCharacterValue(withRobotPart(chef, "colour", ROBOT_PARTS.colour[1]));
  await tap(radio("Color 2"));
  expect(preview().dataset.color).toBe(redChef);
  expect(usesLogoAvatar({ color: redChef, avatarSet: preview().dataset.set })).toBe(false);
  expect(checked("Chef")).toBe(true);
  expect(checked("Color 2")).toBe(true);

  await typeName("Gordon");
  await tap(createButton());
  expect(mocks.createInboxBot).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ name: "Gordon", color: redChef }),
    }),
  );
});

it("keeps Create off until the account's bot style is known", async () => {
  let answer!: (me: { botAvatarSet: string }) => void;
  mocks.rpc.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  await render();
  await typeName("Gordon");
  expect(preview().dataset.set).toBe("organic");
  expect(createButton().disabled).toBe(true);

  await act(async () => answer({ botAvatarSet: "robots" }));
  expect(preview().dataset.set).toBe("robots");
  expect(createButton().disabled).toBe(false);
});

it("says so when the account's bot style cannot be read", async () => {
  const failure = new Error("Account unavailable");
  mocks.rpc.mockRejectedValue(failure);
  await render();
  await typeName("Gordon");
  expect(container.textContent).toContain(errorText(failure));
  expect(createButton().disabled).toBe(true);
});
