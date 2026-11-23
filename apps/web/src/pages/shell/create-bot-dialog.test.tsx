// @vitest-environment jsdom

import type { BotAvatarSet } from "@robots/contracts";
import { parseBotAvatarValue, parseRobotCharacter } from "@robots/contracts";
import { ROBOT_PRESETS, robotCharacterDataUri } from "@robots/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateBotDialogInput } from "./create-bot-dialog";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CreateBotDialog } from "./create-bot-dialog";

const CHARACTER_NAMES = [
  "Assistant",
  "Researcher",
  "Coder",
  "Writer",
  "Analyst",
  "Creator",
  "Chef",
  "Hero",
  "Professor",
  "Detective",
  "Keynote",
  "Hustler",
  "Host",
  "Critic",
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  onCreate: (input: CreateBotDialogInput) => Promise<void>,
  avatarSet: BotAvatarSet = "organic",
) {
  await act(async () => {
    root.render(
      <CreateBotDialog avatarSet={avatarSet} onCancel={() => undefined} onCreate={onCreate} />,
    );
  });
}

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Name your Bot"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("CreateBotDialog", () => {
  it("creates only once the name is not blank", async () => {
    const onCreate = vi.fn(async () => undefined);
    await render(onCreate);
    expect(button("Create").disabled).toBe(true);
    await typeName("   ");
    expect(button("Create").disabled).toBe(true);
    await typeName("  Scout  ");
    expect(button("Create").disabled).toBe(false);
  });

  it.each(["organic", "robots"] as const)(
    "starts %s accounts on a random robot character and sends it as previewed",
    async (avatarSet) => {
      const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
      await render(onCreate, avatarSet);
      expect(document.querySelector('[role="tablist"]')).toBeNull();
      const preview = document.querySelector<HTMLImageElement>(
        '[data-testid="create-bot-dialog"] img',
      )!;
      await typeName("Scout");
      await click(button("Create"));
      const input = onCreate.mock.lastCall![0];
      expect(parseBotAvatarValue(input.color).kind).toBe("robot");
      expect(preview.getAttribute("src")).toBe(
        robotCharacterDataUri(parseRobotCharacter(input.color)!),
      );
      expect(input.id).toMatch(/^c[a-z0-9]{24}$/);
      expect(input).not.toHaveProperty("avatarFamily");
      expect(input).not.toHaveProperty("avatarSet");
    },
  );

  it("offers preset robots and sends the one picked", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    for (const name of CHARACTER_NAMES) expect(button(name)).toBeDefined();
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(CHARACTER_NAMES.length);
    expect(document.querySelector('[data-testid="robot-builder"]')).toBeNull();
    await click(button("Researcher"));
    expect(button("Researcher").getAttribute("aria-checked")).toBe("true");
    await typeName("Scout");
    await click(button("Create"));
    expect(parseRobotCharacter(onCreate.mock.lastCall![0].color)).toEqual(
      ROBOT_PRESETS.find((preset) => preset.id === "researcher")!.look,
    );
  });

  it("shows the error and stays open when creating fails", async () => {
    await render(async () => {
      throw new Error("Bot limit reached");
    });
    await typeName("Scout");
    await click(button("Create"));
    expect(document.querySelector('[data-testid="create-bot-error"]')?.textContent).toBe(
      "Bot limit reached",
    );
    expect(document.querySelector('[data-testid="create-bot-dialog"]')).not.toBeNull();
  });
});

it("retains the preview identity and look through rerenders and a retry", async () => {
  const onCreate = vi
    .fn(async (_input: CreateBotDialogInput) => undefined)
    .mockRejectedValueOnce(new Error("Try again"));
  await render(onCreate, "robots");
  const preview = () =>
    document.querySelector('[data-testid="create-bot-dialog"] img')!.getAttribute("src");
  const look = preview();
  await typeName("First name");
  await render(onCreate, "robots");
  expect(preview()).toBe(look);
  await click(button("Create"));
  const first = onCreate.mock.lastCall![0];
  await typeName("Retry name");
  await click(button("Create"));
  const second = onCreate.mock.lastCall![0];
  expect(first.id).toMatch(/^c[a-z0-9]{24}$/);
  expect(second.id).toBe(first.id);
  expect(second.color).toBe(first.color);
  expect(robotCharacterDataUri(parseRobotCharacter(second.color)!)).toBe(look);
});
