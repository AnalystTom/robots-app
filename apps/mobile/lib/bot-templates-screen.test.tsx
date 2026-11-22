// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BotTemplatesScreen from "../app/(settings)/bot-templates";
import { queryClient } from "./query";

i18n.load("en", {});
i18n.activate("en");

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  focused: true,
  router: { push: vi.fn() },
  addToSearchInbox: vi.fn(),
  openFromSettingsSheet: vi.fn(),
}));
vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (create: () => unknown) => create(),
}));
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  rpc: mocks.rpc,
  currentApiBase: () => "https://app.example.test",
  selectedSpaceId: () => "space-1",
  captureApiRequestContext: async (spaceId: string | null = "space-1") => ({
    apiBase: "https://app.example.test",
    sessionGeneration: 1,
    headers: spaceId ? { "x-robots-space-id": spaceId } : {},
  }),
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => 1 }));
vi.mock("./search-inbox", () => ({
  addToSearchInbox: mocks.addToSearchInbox,
  searchInboxSession: () => "this session",
}));
vi.mock("./settings-sheet", () => ({ openFromSettingsSheet: mocks.openFromSettingsSheet }));
vi.mock("expo-router", () => ({
  useFocusEffect: (effect: () => undefined | (() => void)) =>
    useEffect(() => (mocks.focused ? effect() : undefined), [effect, mocks.focused]),
  useNavigation: () => ({ isFocused: () => mocks.focused }),
  useRouter: () => mocks.router,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/bot-avatar", () => ({
  BotAvatar: ({ color }: { color: string }) => <img alt="" data-avatar={color} />,
}));
vi.mock("../components/connector-icon", () => ({
  ConnectorIcon: ({ name }: { name: string }) => <span data-app={name} />,
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    onPress,
    busy,
  }: {
    label: string;
    onPress: () => void;
    busy?: boolean;
  }) => (
    <button type="button" aria-busy={busy} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View,
    ScrollView: View,
    Text: View,
    ActivityIndicator: () => <span role="status" />,
    Alert: { alert: mocks.alert },
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

const template = {
  id: "standup",
  version: 3,
  name: "Standup",
  summary: "Collects updates",
  avatar: "robot:green.antenna.happy.vest.none",
  instructions: "Ask each person.",
  skills: [],
  routines: [],
  apps: [],
  botId: null as string | null,
};
const bot = { id: "bot-9", name: "Standup" };
const changed = Object.assign(new Error("changed"), { data: { reason: "template_changed" } });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  mocks.focused = true;
  template.botId = null;
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

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => root.render(<BotTemplatesScreen />));
  await settle();
}
const buttons = () => [...container.querySelectorAll("button")] as HTMLButtonElement[];
const action = () => buttons().find((button) => button.textContent !== "Create team")!;
const teamAction = () => buttons().find((button) => button.textContent === "Create team")!;
const reads = () => mocks.rpc.mock.calls.filter(([proc]) => proc === "bots/templates").length;
function hold(call: string) {
  let finish!: (outcome: unknown) => void;
  mocks.rpc.mockImplementation((proc: string) =>
    proc === "bots/templates"
      ? Promise.resolve([{ ...template }])
      : proc === "connections/catalog"
        ? Promise.resolve([])
        : proc === call
          ? new Promise((resolve, reject) => {
              finish = (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome));
            })
          : Promise.reject(new Error(`Unexpected ${proc}`)),
  );
  return {
    finish: async (outcome: unknown) => {
      await act(async () => finish(outcome));
      await settle();
    },
    calls: () => mocks.rpc.mock.calls.filter(([proc]) => proc === call),
  };
}
function expectOpened() {
  expect(mocks.addToSearchInbox.mock.calls).toEqual([[{ kind: "bot", bot }, "this session"]]);
  expect(mocks.openFromSettingsSheet.mock.calls).toEqual([
    [mocks.router, { pathname: "/thread", params: { botId: "bot-9", name: "Standup" } }],
  ]);
}
function expectNothingOpened() {
  expect(mocks.addToSearchInbox).not.toHaveBeenCalled();
  expect(mocks.openFromSettingsSheet).not.toHaveBeenCalled();
}

it("shows each template's robot and creates its bot in one tap, busy meanwhile, then opens its chat", async () => {
  const create = hold("bots/createFromTemplate");
  await render();
  expect(container.querySelector("img")?.getAttribute("data-avatar")).toBe(template.avatar);
  expect(container.textContent).toContain("Collects updates");
  expect(action().textContent).toBe("Create");
  await act(async () => action().click());
  expect(action().getAttribute("aria-busy")).toBe("true");
  expect(create.calls()[0]?.slice(0, 2)).toEqual([
    "bots/createFromTemplate",
    { templateId: "standup", version: 3, name: "Standup" },
  ]);

  await create.finish({ bot, created: true });
  expectOpened();
  expect(action().getAttribute("aria-busy")).toBe("false");
  expect(mocks.alert).not.toHaveBeenCalled();
});

it("opens the bot an earlier create made", async () => {
  template.botId = "bot-9";
  const get = hold("bots/get");
  await render();
  expect(action().textContent).toBe("Open");
  await act(async () => action().click());
  await settle();
  expect(action().getAttribute("aria-busy")).toBe("true");
  expect(get.calls()[0]?.slice(0, 2)).toEqual(["bots/get", { botId: "bot-9" }]);

  await get.finish(bot);
  expectOpened();
  expect(action().getAttribute("aria-busy")).toBe("false");
});

it("says in an alert why a bot was not created or loaded, and offers the action again", async () => {
  const create = hold("bots/createFromTemplate");
  await render();
  await act(async () => action().click());
  await create.finish(new Error("Server said no"));
  expect(mocks.alert.mock.calls).toEqual([["Could not create the bot", "Server said no"]]);
  expect(action().getAttribute("aria-busy")).toBe("false");
  expectNothingOpened();

  await act(async () => root.render(null));
  queryClient.clear();
  template.botId = "bot-9";
  const get = hold("bots/get");
  await render();
  await act(async () => action().click());
  await settle();
  await get.finish(new Error("Server said no"));
  expect(mocks.alert.mock.lastCall).toEqual(["Could not load bot", "Server said no"]);
  expect(action().getAttribute("aria-busy")).toBe("false");
  expectNothingOpened();
});

it("asks to check a template that changed since it was shown, and reads it again", async () => {
  const create = hold("bots/createFromTemplate");
  await render();
  const before = reads();
  await act(async () => action().click());
  await create.finish(changed);
  expect(mocks.alert.mock.calls).toEqual([["This template was just updated. Try again."]]);
  expect(reads()).toBe(before + 1);
});

it.each([
  ["a bot", { bot, created: true }],
  ["a failure", new Error("Server said no")],
])("ignores %s that arrives after the screen lost focus", async (_what, outcome) => {
  const create = hold("bots/createFromTemplate");
  await render();
  await act(async () => action().click());
  mocks.focused = false;
  await render();
  await create.finish(outcome);
  expectNothingOpened();
  expect(mocks.alert).not.toHaveBeenCalled();
});

it("creates one bot when the button is tapped twice in one tick", async () => {
  const create = hold("bots/createFromTemplate");
  await render();
  await act(async () => {
    action().click();
    action().click();
  });
  expect(create.calls()).toHaveLength(1);
  await create.finish({ bot, created: true });
  expectOpened();
});

it.each([
  ["a bot", { bot, created: true }],
  ["a failure", new Error("Server said no")],
])("ignores %s that arrives after the screen has gone", async (_what, outcome) => {
  const create = hold("bots/createFromTemplate");
  await render();
  await act(async () => action().click());
  await act(async () => root.render(null));
  await create.finish(outcome);
  expectNothingOpened();
  expect(mocks.alert).not.toHaveBeenCalled();
});

it("creates the whole team in one tap and opens its lead", async () => {
  const create = hold("bots/createTeamFromTemplate");
  await render();
  await act(async () => teamAction().click());
  expect(create.calls()[0]?.slice(0, 2)).toEqual([
    "bots/createTeamFromTemplate",
    { teamId: "team-autopilot" },
  ]);
  await create.finish({ bots: [bot, { id: "bot-10", name: "Dev" }], failed: [] });
  expectOpened();
});

it("says how many team bots were made when one fails, and retries the whole team", async () => {
  const create = hold("bots/createTeamFromTemplate");
  await render();
  await act(async () => teamAction().click());
  await create.finish({ bots: [bot], failed: ["sales"] });
  expectNothingOpened();
  const [title, message, buttons] = mocks.alert.mock.calls[0]!;
  expect([title, message]).toEqual([
    "Could not create the team",
    "Created 1 of 2 bots. Try again to finish the team.",
  ]);
  await act(async () => buttons[0].onPress());
  expect(create.calls()).toHaveLength(2);
  expect(create.calls()[1]?.slice(0, 2)).toEqual([
    "bots/createTeamFromTemplate",
    { teamId: "team-autopilot" },
  ]);
});
