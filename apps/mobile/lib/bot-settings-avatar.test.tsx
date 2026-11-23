// @vitest-environment jsdom

import { BOT_COLORS } from "@robots/contracts";
import { DEFAULT_BOT_AVATAR_COLOR } from "@robots/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import "./bot-settings-test-setup";

import { mocks, mountBotSettings } from "./bot-settings-test-setup";

describe("bot settings avatar", () => {
  const dom = mountBotSettings();

  it("keeps an Original bot's set until a look is picked, saves the pick with its set, and reloads it", async () => {
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    const setMenu = () => dom.container.querySelector('[data-menu="Icon set"]')!;
    const option = (label: string) =>
      [...setMenu().querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === label,
      )!;
    expect(option("Original").dataset.state).toBe("on");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => option("RoBots").click());
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ avatarSet: "robots" });
    await act(async () =>
      dom.container
        .querySelector<HTMLButtonElement>('[role="radio"][aria-label="Detective"]')!
        .click(),
    );
    await act(async () =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      color: "robot:purple.deerstalker.magnifier.cape.none",
      avatarSet: "robots",
    });
    dom.remount();
    mocks.avatarSet = "robots";
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    expect(option("RoBots").dataset.state).toBe("on");
    await act(async () => option("Original").click());
    mocks.rpc.mockResolvedValueOnce({ avatarSet: "organic" });
    await act(async () =>
      dom.container
        .querySelector<HTMLButtonElement>('[role="radio"][aria-label="Color 2"]')!
        .click(),
    );
    await act(async () =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("bots/update", {
      botId: "bot-fixture",
      color: BOT_COLORS[1],
      avatarSet: "organic",
    });
  });

  it("saves a non-robot colour when a stored RoBots bot is switched to Original", async () => {
    mocks.avatarSet = "robots";
    mocks.color = "robot:purple.deerstalker.magnifier.cape.none";
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    const setOption = (label: string) =>
      [...dom.container.querySelectorAll<HTMLButtonElement>('[data-menu="Icon set"] button')].find(
        (button) => button.textContent === label,
      )!;
    mocks.rpc.mockResolvedValueOnce({ avatarSet: "organic" });
    await act(async () => setOption("Original").click());
    await act(async () =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      color: DEFAULT_BOT_AVATAR_COLOR,
      avatarSet: "organic",
    });
  });

  it("discards a pending robot pick when the Icon set is switched, so Save never stores RoBots", async () => {
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    const setOption = (label: string) =>
      [...dom.container.querySelectorAll<HTMLButtonElement>('[data-menu="Icon set"] button')].find(
        (button) => button.textContent === label,
      )!;
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Hero"]')!.click(),
    );
    await act(async () => setOption("Original").click());
    expect(setOption("Original").dataset.state).toBe("on");
    expect(
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Save",
      ),
    ).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalledWith("bots/update", expect.anything());
  });

  it("shows a stored off-list robot as the selected Current look and saves only a picked preset", async () => {
    mocks.avatarSet = "robots";
    mocks.color = "robot:green.top-hat.grumpy.cape.none";
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    const tile = (label: string) =>
      dom.container.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${label}"]`)!;
    expect(tile("Current look").dataset.checked).toBe("true");
    expect(tile("Detective").dataset.checked).toBe("false");
    expect(mocks.rpc).not.toHaveBeenCalledWith("bots/update", expect.anything());

    await act(async () => tile("Detective").click());
    expect(dom.container.querySelector('[role="radio"][aria-label="Current look"]')).toBeNull();
    expect(tile("Detective").dataset.checked).toBe("true");
    expect(mocks.rpc).not.toHaveBeenCalledWith("bots/update", expect.anything());

    await act(async () =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "bots/update",
      expect.objectContaining({
        botId: "bot-fixture",
        color: "robot:purple.deerstalker.magnifier.cape.none",
      }),
    );
  });

  it("keeps a stored robot look through Icon set switches and saves nothing until a look is picked", async () => {
    mocks.avatarSet = "robots";
    mocks.color = "robot:purple.deerstalker.magnifier.cape.none";
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    const setOption = (label: string) =>
      [...dom.container.querySelectorAll<HTMLButtonElement>('[data-menu="Icon set"] button')].find(
        (button) => button.textContent === label,
      )!;
    await act(async () => setOption("Original").click());
    await act(async () => setOption("RoBots").click());
    expect(mocks.rpc).not.toHaveBeenCalledWith("bots/update", expect.anything());
    expect(
      dom.container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Detective"]')!
        .dataset.checked,
    ).toBe("true");
    expect(
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Save",
      ),
    ).toBeUndefined();
  });

  it("saves the robots set when a robot look is picked while the Original set is open", async () => {
    mocks.avatarSet = "organic";
    mocks.color = BOT_COLORS[0]!;
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Hero"]')!.click(),
    );
    mocks.rpc.mockResolvedValueOnce({ avatarSet: "robots" });
    await act(async () =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("bots/update", {
      botId: "bot-fixture",
      color: "robot:red.antenna.aviators.cape.confetti",
      avatarSet: "robots",
    });
  });
});
