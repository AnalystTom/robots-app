// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../lib/rpc", () => ({
  rpc: {},
  rpcForSpace: () => ({}),
  createSpaceRpc: () => ({}),
  selectedSpaceId: () => null,
}));
vi.mock("../components/DevicePairingSettings", () => ({
  DevicePairingSettings: ({ sharedUrls }: { sharedUrls: string[] }) => (
    <p data-testid="pairing">{sharedUrls.join(" ")}</p>
  ),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => text + part + (index < values.length ? values[index] : ""),
      "",
    );
  return {
    useLingui: () => ({ t, i18n: { locale: "en-US" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@robots/ui-web", async () => {
  const { createContext, useContext } = await import("react");
  type Choice = {
    value: string;
    onValueChange: (value: string) => void;
    items: Array<{ value: string; label: string }>;
  };
  const Choices = createContext<Choice | null>(null);
  return {
    Select: ({ children, ...choice }: Choice & { children: ReactNode }) => (
      <Choices.Provider value={choice}>{children}</Choices.Provider>
    ),
    SelectTrigger: ({ "aria-label": label }: { "aria-label": string }) => {
      const choice = useContext(Choices)!;
      return (
        <select
          aria-label={label}
          value={choice.value}
          onChange={(event) => choice.onValueChange(event.target.value)}
        >
          {choice.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      );
    },
    SelectValue: () => null,
    SelectContent: () => null,
    SelectGroup: () => null,
    SelectItem: () => null,
  };
});

import { DevicesSettingsPanel } from "./DevicesSettingsPanel";

const off = { mode: "off", available: ["off", "local"], urls: [], error: null };

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  delete window.robotsDesktop;
  document.body.innerHTML = "";
});

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={new QueryClient()}>
        <DevicesSettingsPanel />
      </QueryClientProvider>,
    );
  });
  return container;
}

function choose(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

it("shows only pairing in a browser", async () => {
  const container = await render();
  expect(container.querySelector('[data-testid="network-access"]')).toBeNull();
  expect(container.querySelector('[data-testid="pairing"]')).not.toBeNull();
});

it("opens the desktop stack to the local network and pairs over its address", async () => {
  const local = { ...off, mode: "local", urls: ["http://192.168.1.20:45173"] };
  const network = { state: vi.fn(async () => off), setMode: vi.fn(async () => local) };
  window.robotsDesktop = { network } as never;
  const container = await render();
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Who can open RoBots"]',
  )!;
  expect(select.value).toBe("off");
  await act(async () => choose(select, "local"));
  expect(network.setMode).toHaveBeenCalledWith("local");
  await vi.waitFor(() => expect(container.textContent).toContain("http://192.168.1.20:45173"));
  expect(container.querySelector('[data-testid="pairing"]')?.textContent).toBe(
    "http://192.168.1.20:45173",
  );
});

it("says why private network HTTPS did not turn on", async () => {
  const network = {
    state: vi.fn(async () => ({ ...off, error: "no-https" })),
    setMode: vi.fn(),
  };
  window.robotsDesktop = { network } as never;
  const container = await render();
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Turn on HTTPS names for your private network first.",
    ),
  );
});
