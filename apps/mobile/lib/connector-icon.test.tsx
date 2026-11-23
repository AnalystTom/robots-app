// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConnectorIcon } from "../components/connector-icon";
import { currentApiBase, setCachedApiBase } from "./api";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("./ai-consent", () => ({ promptAiConsent: vi.fn() }));
vi.mock("./live-notifications.js", () => ({
  resumeLiveNotifications: vi.fn(async () => undefined),
  stopLiveNotifications: vi.fn(async () => undefined),
}));
vi.mock("./network-cache.js", () => ({ clearNetworkCache: vi.fn() }));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("react-native-svg", () => ({ SvgUri: () => null }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Image: ({ source }: { source: { uri: string } }) => createElement("img", { src: source.uri }),
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

let container: HTMLDivElement;
let root: Root;
let originalApiBase: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalApiBase = currentApiBase();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setCachedApiBase(originalApiBase);
  vi.unstubAllGlobals();
});

it("loads a server-relative logo from the configured API base", async () => {
  setCachedApiBase("https://robots-logos.example.test");
  await act(async () =>
    root.render(
      createElement(ConnectorIcon, {
        name: "Example",
        logo: "/api/v1/plugin-logos/Cursor/bG9nby5zdmc.png",
      }),
    ),
  );
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    "https://robots-logos.example.test/api/v1/plugin-logos/Cursor/bG9nby5zdmc.png",
  );
});
