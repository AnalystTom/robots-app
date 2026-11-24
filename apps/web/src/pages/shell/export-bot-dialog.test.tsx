// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

const exportPackage = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({
  rpc: { bots: { exportPackage } },
  rpcForSpace: () => ({ bots: { exportPackage } }),
  createSpaceRpc: () => ({ bots: { exportPackage } }),
  selectedSpaceId: () => null,
}));
const download = vi.fn();
vi.mock("../../lib/artifact-open", () => ({
  downloadArtifactBytes: (...args: unknown[]) => download(...args),
}));

import { ExportBotDialog } from "./export-bot-dialog";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  exportPackage.mockReset();
  download.mockReset();
  i18n.load("en", {});
  i18n.activate("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const button = (label: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === label)!;

it("exports the package, with memory notes only when ticked, as a .robot.json file", async () => {
  const pkg = { format: "robots.bot-package", version: 1 };
  exportPackage.mockResolvedValue(pkg);
  const onClose = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <ExportBotDialog bot={{ id: "bot-1", name: "Pebble Bot" }} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  const memory = document.querySelector<HTMLElement>(
    '[data-testid="export-bot-memory"] [role="checkbox"]',
  )!;
  expect(memory.getAttribute("aria-checked")).toBe("false");
  await act(async () => memory.click());

  await act(async () => button("Export").click());
  expect(exportPackage).toHaveBeenCalledWith({ botId: "bot-1", includeMemory: true });
  const [name, type, bytes] = download.mock.calls[0]!;
  expect([name, type]).toEqual(["pebble-bot.robot.json", "application/json"]);
  expect(JSON.parse(new TextDecoder().decode(bytes as Uint8Array))).toEqual(pkg);
  expect(onClose).toHaveBeenCalled();
});

it("stays open and says so when the export fails", async () => {
  exportPackage.mockRejectedValue(new Error("offline"));
  const onClose = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <ExportBotDialog bot={{ id: "bot-1", name: "Pebble" }} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  await act(async () => button("Export").click());
  expect(onClose).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
