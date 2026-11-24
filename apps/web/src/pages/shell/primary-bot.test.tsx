// @vitest-environment jsdom

import type { Bot } from "@robots/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { robotPresetValue } from "@robots/core";
import { isPrimaryBot, PrimaryBotRow, primaryBotCreateInput } from "./primary-bot";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const bot = {
  id: "cprimary",
  name: "RoBot",
  color: primaryBotCreateInput("RoBot").color,
  status: "idle",
  unread: false,
  spawnKey: "primary",
} as Bot;

it("knows the Primary Bot by its spawn key, whatever its name", () => {
  expect(isPrimaryBot({ spawnKey: "primary" })).toBe(true);
  expect(isPrimaryBot({ spawnKey: null })).toBe(false);
  expect(isPrimaryBot({ spawnKey: "onboarding:first" })).toBe(false);
  const input = primaryBotCreateInput("Chief");
  expect(input).toMatchObject({ name: "Chief", spawnKey: "primary", fleetManagement: true });
  expect(input.instructions).toContain("message_bot");
  expect(input.color).toBe(robotPresetValue("assistant"));
});

it("opens the Primary Bot, or offers to set one up", async () => {
  const onOpen = vi.fn();
  const onSetUp = vi.fn();
  await act(async () => {
    root.render(
      <PrimaryBotRow
        bot={undefined}
        current={false}
        mini={false}
        creating={false}
        onOpen={onOpen}
        onSetUp={onSetUp}
      />,
    );
  });
  const setUp = container.querySelector<HTMLButtonElement>('[data-testid="primary-bot-setup"]')!;
  expect(setUp.textContent).toContain("Set up RoBot");
  await act(async () => setUp.click());
  expect(onSetUp).toHaveBeenCalledOnce();

  await act(async () => {
    root.render(
      <PrimaryBotRow
        bot={bot}
        current
        mini={false}
        creating={false}
        onOpen={onOpen}
        onSetUp={onSetUp}
      />,
    );
  });
  const row = container.querySelector<HTMLButtonElement>('[data-testid="primary-bot"]')!;
  expect(row.getAttribute("aria-current")).toBe("page");
  expect(row.textContent).toContain("RoBot");
  await act(async () => row.click());
  expect(onOpen).toHaveBeenCalledWith(bot);
});
