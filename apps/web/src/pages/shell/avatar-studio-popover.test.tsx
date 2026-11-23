// @vitest-environment jsdom

import { parseRobotCharacter } from "@robots/contracts";
import { robotCharacterDataUri } from "@robots/core";
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
const changed = vi.fn<(value: string) => void>();

function Harness({ value: initial }: { value: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AvatarStudioPopover
      value={value}
      identity="sample-bot"
      onChange={(next) => {
        changed(next);
        setValue(next);
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
async function render(value: string) {
  await act(async () => root.render(<Harness key={value} value={value} />));
}

describe("the robot-only picker", () => {
  it.each([
    ["a plain hex", "#10B981"],
    ["an organic shape", "#8B5CF6::shape_2"],
  ] as const)("draws %s as a robot preset and offers no Original style", async (_label, value) => {
    await render(value);
    expect(document.querySelector(".robots-organic-avatar")).toBeNull();
    expect(document.querySelector(".robots-logo-avatar")).toBeNull();
    expect(document.querySelector('img[src^="data:image/svg+xml"]')).not.toBeNull();
    await click("Customize bot avatar");
    expect(document.body.textContent).not.toContain("Original");
    expect(document.body.textContent).not.toContain("More styles");
    expect(document.querySelector('[role="tab"][aria-selected]')).not.toBeNull();
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(15);
    expect(changed).not.toHaveBeenCalled();
  });

  it("replaces a photo only when a robot is picked", async () => {
    const photo = "data:image/png;base64,abc";
    await render(photo);
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Hero");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`img[src="${photo}"]`)).toBeNull();
  });

  it("keeps a legacy robot the bot wears, lists only the listed robots, and saves only a picked one", async () => {
    const legacyRobot = "robot:teal.top-hat.hearts.cape.none";
    const detective = "robot:purple.deerstalker.magnifier.cape.none";
    await render(legacyRobot);
    const legacyUri = robotCharacterDataUri(parseRobotCharacter(legacyRobot)!);
    expect([...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toContain(
      legacyUri,
    );
    await click("Customize bot avatar");
    const checked = () =>
      [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].map((node) =>
        node.getAttribute("aria-label"),
      );
    const listed = [...document.querySelectorAll('[role="radio"]')].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(listed).toEqual([
      "Assistant",
      "Researcher",
      "Coder",
      "Writer",
      "Analyst",
      "Creator",
      "Chef",
      "Hero",
      "Hoodie",
      "Critic",
      "Professor",
      "Detective",
      "Keynote",
      "Hustler",
      "Host",
    ]);
    expect(checked()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    await click("Detective");
    expect(changed).toHaveBeenLastCalledWith(detective);
    expect(checked()).toEqual(["Detective"]);
  });
});
