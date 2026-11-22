// @vitest-environment jsdom
import type { AiRecipient } from "@robots/contracts";
import { tokensForAppearance } from "@robots/ui-tokens";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BackHandler, Linking, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConsentScreen } from "../components/ai-consent-screen";
import { promptAiConsent } from "./ai-consent";

vi.mock("react-native", () => {
  type Props = { children?: ReactNode; testID?: string };
  return {
    Platform: { OS: "android" },
    BackHandler: { exitApp: vi.fn() },
    Linking: { openURL: vi.fn(async () => undefined) },
    StyleSheet: { create: (styles: unknown) => styles },
    View: ({ children, testID }: Props) =>
      createElement("div", { "data-testid": testID }, children),
    Text: ({ children }: Props) => createElement("p", null, children),
    Modal: ({ children, onRequestClose }: Props & { onRequestClose?: () => void }) =>
      createElement(
        "section",
        null,
        createElement("button", { type: "button", onClick: onRequestClose }, "System back"),
        children,
      ),
  };
});
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));
vi.mock("../components/app-mark", () => ({ AppMark: () => null }));
vi.mock("./session", () => ({ registerSessionDiskCache: vi.fn() }));
vi.mock("./native", () => ({
  native: {},
  useMobileTokens: () => tokensForAppearance("light"),
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

const openai: AiRecipient = {
  key: "openai-model",
  name: "OpenAI",
  use: "model",
  detail: "",
  allowed: false,
};
const openaiMemory: AiRecipient = { ...openai, key: "openai-memory", use: "memory" };

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

function text() {
  return container.textContent ?? "";
}

async function click(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label} in ${text()}`);
  await act(async () => found.click());
}

async function ask(recipients: AiRecipient[], grant = vi.fn(async () => undefined)) {
  let decided: boolean | undefined;
  const pending = promptAiConsent(recipients, "https://robots.example/privacy", grant).then(
    (value) => {
      decided = value;
    },
  );
  await act(async () => undefined);
  return { pending, decided: () => decided, grant };
}

describe("AI data sharing consent screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Platform.OS = "android";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(AiConsentScreen)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("names the company once and continues the action on Approve", async () => {
    const consent = await ask([openai, openaiMemory]);
    expect(text()).toContain("Share data with OpenAI?");
    expect(text()).toContain("sent to run your bots");
    expect(text()).toContain("sent to store and recall context");
    expect(text()).not.toContain("Codex");

    await click("Privacy policy");
    expect(Linking.openURL).toHaveBeenCalledWith("https://robots.example/privacy");

    await click("Approve");
    await consent.pending;
    expect(consent.decided()).toBe(true);
    expect(container.querySelector("[data-testid='ai-consent-screen']")).toBeNull();
  });

  it("settles every queued and late iOS request as declined when denied", async () => {
    Platform.OS = "ios";
    const first = await ask([openai]);
    const queued = await ask([openaiMemory]);
    await click("Deny");
    await Promise.all([first.pending, queued.pending]);
    expect(first.decided()).toBe(false);
    expect(queued.decided()).toBe(false);
    expect(first.grant).not.toHaveBeenCalled();
    expect(queued.grant).not.toHaveBeenCalled();

    const late = await ask([openai]);
    await late.pending;
    expect(late.decided()).toBe(false);
    expect(text()).toContain("RoBots needs this to work");

    await click("Review again");
    expect(text()).toContain("Share data with OpenAI?");
    await click("Approve");
    await vi.waitFor(() => expect(first.grant).toHaveBeenCalledOnce());
    expect(queued.grant).not.toHaveBeenCalled();
  });

  it("closes the app on Android when denied and asks again on return", async () => {
    const consent = await ask([openai]);
    await click("Deny");
    expect(BackHandler.exitApp).toHaveBeenCalledOnce();
    expect(consent.decided()).toBeUndefined();
    expect(text()).toContain("Share data with OpenAI?");

    await click("System back");
    expect(BackHandler.exitApp).toHaveBeenCalledTimes(2);

    await click("Approve");
    await consent.pending;
    expect(consent.decided()).toBe(true);
  });

  it("settles a denied iOS prompt as declined, and grants on Approve after Review again", async () => {
    Platform.OS = "ios";
    const grant = vi.fn(async () => undefined);
    const consent = await ask([openai], grant);
    await click("Deny");
    await consent.pending;
    expect(consent.decided()).toBe(false);
    expect(BackHandler.exitApp).not.toHaveBeenCalled();
    expect(text()).toContain("RoBots needs this to work");
    expect(text()).not.toContain("Approve");

    await click("Review again");
    expect(text()).toContain("Share data with OpenAI?");
    expect(grant).not.toHaveBeenCalled();
    await click("Approve");
    await vi.waitFor(() => expect(grant).toHaveBeenCalledOnce());
    expect(container.querySelector("[data-testid='ai-consent-screen']")).toBeNull();
  });
});
