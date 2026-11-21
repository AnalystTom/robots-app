// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import type { ActionRule, Connection, ConnectionCatalogItem } from "@robots/contracts";
import { MAC_APP_CONNECTIONS } from "@robots/contracts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationDetail } from "../components/integration-detail";
import { MacAppDetail } from "../components/mac-app-detail";
import { queryClient } from "./query";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  rules: [] as ActionRule[],
  mode: "ask" as "ask" | "never" | "auto",
}));
const { element } = vi.hoisted(() => ({
  element:
    (tag: string) =>
    ({ children, testID }: { children?: ReactNode; testID?: string }) =>
      createElement(tag, { "data-testid": testID }, children),
}));

vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./native", () => ({
  native: {},
  useResolvedAppearance: () => "light",
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("./user-error", () => ({ errorText: (_: unknown, fallback: string) => fallback }));
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  rpc: state.rpc,
  currentApiBase: () => "https://app.example.test",
  selectedSpaceId: () => "space-a",
  captureApiRequestContext: async () => ({
    apiBase: "https://app.example.test",
    sessionGeneration: 1,
    headers: { "x-robots-space-id": "space-a" },
  }),
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => 1 }));
vi.mock("./user-devices", () => ({ listUserDevices: async () => [] }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Modal: element("section"),
  Platform: { OS: "ios" },
  Pressable: ({
    children,
    onPress,
    testID,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
  }) =>
    createElement(
      "button",
      { type: "button", onClick: onPress, "data-testid": testID, "aria-label": accessibilityLabel },
      children,
    ),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: element("span"),
  TextInput: ({ value, accessibilityLabel }: { value: string; accessibilityLabel?: string }) =>
    createElement("input", { value, readOnly: true, "aria-label": accessibilityLabel }),
  View: element("div"),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("../components/connector-icon", () => ({ ConnectorIcon: () => null }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/row-accessories", () => ({ Chevron: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));
vi.mock("../components/native-switch", () => ({
  NativeSwitch: ({
    value,
    onValueChange,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
  }) =>
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-checked": value,
      "aria-label": accessibilityLabel,
      onClick: () => onValueChange(!value),
    }),
}));
vi.mock("../components/menu-picker", () => ({
  MenuPicker: ({
    label,
    choices,
    value,
    onChange,
    onPress,
  }: {
    label: string;
    choices: { key: string; label: string }[];
    value: string;
    onChange: (key: string) => void;
    onPress?: () => void;
  }) =>
    createElement(
      "div",
      { "aria-label": label, "data-value": choices.find((choice) => choice.key === value)?.label },
      onPress
        ? createElement("button", { type: "button", onClick: onPress }, label)
        : choices.map((choice) =>
            createElement(
              "button",
              { key: choice.key, type: "button", onClick: () => onChange(choice.key) },
              choice.label,
            ),
          ),
    ),
}));

const item: ConnectionCatalogItem = {
  connectorId: "composio",
  slug: "gmail",
  name: "Gmail",
  logo: null,
  connected: true,
  noAuth: false,
};
const account: Connection = {
  id: "c1",
  connectorId: "composio",
  provider: "gmail",
  displayName: "Work Gmail",
  status: "connected",
  capabilities: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};
const tools = [
  { name: "GMAIL_SEND_EMAIL", description: "Send" },
  { name: "GMAIL_LIST_MESSAGES", description: "List", readOnly: true },
  { name: "GMAIL_ADD_LABEL", description: "Label" },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  queryClient.clear();
  state.rules = [];
  state.mode = "ask";
  state.rpc.mockReset().mockImplementation(async (procedure: string, input: unknown) => {
    if (procedure === "actionRules/list") return state.rules;
    if (procedure === "actionRules/set") {
      state.rules = (input as { rules: ActionRule[] }).rules;
      return state.rules;
    }
    if (procedure === "approvalRules/list") return [];
    if (procedure === "autoReview/get")
      return {
        mode: state.mode,
        enabled: false,
        checkerAvailable: false,
        skipApprovals: state.mode === "never",
      };
    throw new Error(`unexpected ${procedure}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(accounts: Connection[] = [account]) {
  await act(async () =>
    root.render(
      <IntegrationDetail
        item={item}
        accounts={accounts}
        pending={null}
        labelDrafts={{}}
        setLabelDrafts={() => undefined}
        tools={tools}
        toolsLoading={false}
        botName="Robo"
        onBack={() => undefined}
        onUninstall={() => undefined}
        onRename={() => undefined}
        onRevoke={() => undefined}
        onConnect={() => undefined}
      />,
    ),
  );
  await flush();
}

function button(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent === text);
}

it("shows a not-connected app with one Connect row and no tools", async () => {
  await render([]);
  expect(container.textContent).toContain("Always on");
  expect(container.textContent).toContain("Gmail account");
  expect(button(container, "Connect")).toBeDefined();
  expect(container.querySelector('[data-testid="connection-tools"]')).toBeNull();
});

it("lists accounts and tools with their permission and the guard caption", async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('[aria-label="Account label"]')?.value).toBe(
    "Work Gmail",
  );
  expect(container.querySelector('[aria-label="Send email"]')?.getAttribute("data-value")).toBe(
    "Ask each time",
  );
  expect(container.querySelector('[data-testid="tool-row-lookups"]')?.textContent).toContain(
    "Allowed",
  );
  expect(container.textContent).toContain("Robo asks before each email");
  await act(async () => button(container, "Off")?.click());
  await flush();
  expect(state.rpc).toHaveBeenCalledWith(
    "actionRules/set",
    {
      rules: [expect.objectContaining({ matchValue: "GMAIL_ADD_LABEL", effect: "deny" })],
    },
    expect.anything(),
  );
});

it("turns a risky capability off and on again from its permission sheet", async () => {
  await render();
  await act(async () => button(container, "Send email")?.click());
  await flush();
  const sheet = container.querySelector('[data-testid="permission-dialog"]');
  expect(sheet?.textContent).toContain("Allow Robo to send email");
  const toggle = () => sheet?.querySelector<HTMLElement>('[role="switch"]');
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle()?.click());
  await flush();
  expect(state.rules).toEqual([
    expect.objectContaining({ matchValue: "GMAIL_SEND_EMAIL", initiator: null, effect: "deny" }),
  ]);
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  expect(container.textContent?.split("Robo asks before each email")).toHaveLength(2);
  await act(async () => toggle()?.click());
  await flush();
  expect(state.rules).toEqual([]);
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
});

it("shows a Mac app with its Mac access, grants and send permission sheet", async () => {
  const mail = MAC_APP_CONNECTIONS.find((app) => app.id === "mail");
  if (!mail) throw new Error("Mail is missing");
  await act(async () =>
    root.render(<MacAppDetail app={mail} botName="Robo" onBack={() => undefined} />),
  );
  await flush();
  expect(container.textContent).toContain("Works while it's online");
  expect(container.textContent).toContain("Open RoBots on your Mac to connect");
  expect(container.textContent).toContain("Control Mail");
  expect(container.querySelector('[data-testid="tool-row-lookups"]')?.textContent).toContain(
    "Asks once",
  );
  expect(container.querySelector('[aria-label="Write a draft"]')?.textContent).toBe(
    "AllowedAsk each timeOffAsks once",
  );
  await act(async () => button(container, "Send an email")?.click());
  await flush();
  const sheet = container.querySelector('[data-testid="permission-dialog"]');
  expect(sheet?.textContent).toContain("Allow Robo to send email");
  expect(sheet?.textContent).toContain("Open RoBots on your Mac to allow");

  const appSwitch = container.querySelector<HTMLElement>('[aria-label="Let Robo use Mail"]');
  expect(appSwitch?.getAttribute("aria-checked")).toBe("true");
  await act(async () => appSwitch?.click());
  await flush();
  expect(state.rules).toEqual([
    expect.objectContaining({ matchKind: "connector", matchValue: "mac_mail", effect: "deny" }),
  ]);
  expect(container.querySelector('[data-testid="tool-row-lookups"]')?.textContent).toContain("Off");
});
