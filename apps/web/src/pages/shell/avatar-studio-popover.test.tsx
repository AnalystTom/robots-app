// @vitest-environment jsdom

import type { BotAvatarSet } from "@robots/contracts";
import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterDataUri } from "@robots/core";
import { DEFAULT_BOT_AVATAR_COLOR } from "@robots/ui-web";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { AvatarStudioPopover } from "./avatar-studio-popover";

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn<(value: string, avatarSet?: BotAvatarSet) => void>();

function Harness({
  value: initial,
  avatarSet: initialSet,
}: {
  value: string;
  avatarSet?: BotAvatarSet;
}) {
  const [value, setValue] = useState(initial);
  const [avatarSet, setAvatarSet] = useState(initialSet);
  return (
    <AvatarStudioPopover
      value={value}
      identity="sample-bot"
      avatarSet={avatarSet}
      onChange={(next, nextSet) => {
        changed(next, nextSet);
        setValue(next);
        if (nextSet !== undefined) setAvatarSet(nextSet);
      }}
    />
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function render(value: string, avatarSet?: BotAvatarSet, key = "initial") {
  await act(async () => root.render(<Harness key={key} value={value} avatarSet={avatarSet} />));
}

describe("selectable bot icon sets", () => {
  it("keeps a legacy appearance on open, saves a RoBots switch, and restores the saved set on reload", async () => {
    await render("#10B981");
    await click("Customize bot avatar");
    expect(button("Original").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".robots-organic-avatar")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    await click("RoBots");
    expect(changed).toHaveBeenLastCalledWith("#10B981", "robots");
    expect(document.querySelector(".robots-logo-avatar")).not.toBeNull();
    await render("#10B981", "robots", "reload");
    await click("Customize bot avatar");
    expect(button("RoBots").getAttribute("aria-selected")).toBe("true");
    await click("Original");
    expect(changed).toHaveBeenLastCalledWith("#10B981", "organic");
    expect(document.querySelector(".robots-organic-avatar")).not.toBeNull();
    expect(button("wedge")).toBeDefined();
  });

  it("leaves a photo intact until the user explicitly selects another set", async () => {
    const photo = "data:image/png;base64,abc";
    await render(photo);
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("RoBots");
    expect(changed).toHaveBeenLastCalledWith(DEFAULT_BOT_AVATAR_COLOR, "robots");
    expect(document.querySelector(`img[src="${photo}"]`)).toBeNull();
  });

  it("shows a bot's own robot as the selected current look until a listed robot is picked", async () => {
    const ownRobot = "robot:teal.top-hat.hearts.cape.none";
    const detective = "robot:purple.deerstalker.magnifier.cape.none";
    await render(ownRobot, "robots");
    await click("Customize bot avatar");
    const checked = () =>
      [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].map((node) =>
        node.getAttribute("aria-label"),
      );
    expect(checked()).toEqual(["Current look"]);
    expect(button("Current look").querySelector("img")?.getAttribute("src")).toBe(
      robotCharacterDataUri(parseRobotCharacter(ownRobot)!),
    );
    expect(changed).not.toHaveBeenCalled();
    await click("Current look");
    expect(changed).toHaveBeenLastCalledWith(ownRobot, undefined);
    await click("Detective");
    expect(changed).toHaveBeenLastCalledWith(detective, undefined);
    expect(checked()).toEqual(["Detective"]);
    expect(document.querySelector('[aria-label="Current look"]')).toBeNull();
  });

  it("keeps explicit original shapes and their chosen set while changing colour", async () => {
    await render("#8B5CF6::shape_2", "organic");
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    await click("Color #00C972");
    expect(changed).toHaveBeenLastCalledWith("#00C972::shape_2", undefined);
    expect(button("Original").getAttribute("aria-selected")).toBe("true");
    await click("RoBots");
    expect(changed).toHaveBeenLastCalledWith("#00C972", "robots");
  });
});
