// @vitest-environment jsdom

import "./bot-settings-test-setup";

import { BOT_SETTINGS_SECTIONS } from "@robots/contracts";
import * as Notifications from "expo-notifications";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import BotSettingsScreen from "../app/bot-settings";
import { MenuPicker } from "../components/menu-picker";
import { deferredSave, mocks, mountBotSettings, offered } from "./bot-settings-test-setup";
import { afterChatNotifyChange } from "./live-notifications";

describe("bot settings device voice menu", () => {
  const dom = mountBotSettings();

  it("defaults daily check-ins on and saves an opt-out", async () => {
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Daily check-ins on unfinished work"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      dailyCheckIns: false,
    });
  });

  it.each([false, true])("loads and saves cross-space communication: %s", async (enabled) => {
    mocks.crossSpaceCommunication = enabled;
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Allow cross-space bot communication"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe(String(enabled));
    await act(async () => toggle.click());
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      crossSpaceCommunication: !enabled,
    });
  });

  it.each(["ios", "android"])(
    "uses muted section disclosure and nonrepeating labels on %s",
    async (os) => {
      mocks.os = os;
      await act(async () => dom.root.render(<BotSettingsScreen />));
      const trigger = dom.container.querySelector<HTMLButtonElement>('[aria-label="Advanced"]')!;
      expect(trigger.getAttribute("role")).toBe("button");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(JSON.parse(trigger.dataset.style!)).toMatchObject({ minHeight: 44 });
      expect(JSON.parse(trigger.dataset.style!)).not.toHaveProperty("backgroundColor");
      expect(JSON.parse(trigger.querySelector("span")!.dataset.style!)).toMatchObject({
        color: "muted",
        fontSize: 14,
      });
      const heading = [...dom.container.querySelectorAll('[role="header"]')].find(
        (node) => node.textContent === "Notifications",
      )!;
      expect(heading).toBeDefined();
      expect(JSON.parse((heading.parentElement as HTMLElement).dataset.style!)).toMatchObject({
        gap: 7,
      });
      expect(
        dom.container.querySelector(
          '[role="switch"][aria-label="When it finishes or needs input"]',
        ),
      ).not.toBeNull();
      await dom.expand();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const model = dom.container.querySelector('[data-menu="Model"]')!;
      expect([...model.querySelectorAll("span")].some((node) => node.textContent === "Model")).toBe(
        false,
      );
      expect(model.querySelector('[aria-label="Model"]')).not.toBeNull();
      await dom.expand();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("adds work from the native prompt and completes it with a leading checkbox", async () => {
    mocks.work = [{ id: "first", title: "First task", notes: "", status: "open" }];
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Add open work"]')!.click(),
    );
    expect(mocks.prompt).toHaveBeenCalledWith(
      "Add open work",
      undefined,
      expect.any(Array),
      "plain-text",
      "",
    );
    mocks.rpc.mockResolvedValueOnce({ id: "new", title: "New task", notes: "", status: "open" });
    const buttons = mocks.prompt.mock.calls.at(-1)![2];
    await act(async () =>
      buttons.find((button: { text: string }) => button.text === "Save").onPress("New task"),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("scratchpad/create", {
      botId: "bot-fixture",
      title: "New task",
    });
    const complete = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Complete New task"]',
    )!;
    expect(complete.getAttribute("role")).toBe("checkbox");
    expect(JSON.parse(complete.dataset.style!)).toMatchObject({ minHeight: 22, width: 22 });
    expect(complete.dataset.hitSlop).toBe("11");
    mocks.rpc.mockResolvedValueOnce({});
    await act(async () => complete.click());
    expect(mocks.rpc).toHaveBeenCalledWith("scratchpad/update", { itemId: "new", status: "done" });
    expect(dom.container.textContent).not.toContain("New task");
  });

  it("restores instructions through the history icon's native menu", async () => {
    mocks.history = [
      {
        id: "v1",
        instructions: "Earlier",
        reason: "Manual edit",
        createdAt: "2026-10-01T00:00:00Z",
      },
    ];
    await dom.render();
    const history = dom.container.querySelector('[data-menu="Instruction history"]')!;
    expect(history.querySelector('[aria-label="Instruction history"]')).not.toBeNull();
    await act(async () => history.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.alert).toHaveBeenCalledWith("Restore", "Earlier", expect.any(Array));
    mocks.rpc.mockResolvedValueOnce({
      id: "bot-fixture",
      instructions: "Earlier",
      color: mocks.color,
    });
    await act(async () => mocks.alert.mock.calls.at(-1)![2][1].onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("bots/restoreInstructions", {
      botId: "bot-fixture",
      versionId: "v1",
      expectedInstructions: "",
    });
  });

  it.each([false, true])(
    "locks instruction edits and Save during restore (fails: %s)",
    async (fails) => {
      mocks.history = [
        {
          id: "v1",
          instructions: "Earlier",
          reason: "Manual edit",
          createdAt: "2026-10-01T00:00:00Z",
        },
      ];
      const restore = deferredSave<{ id: string; instructions: string; color: string }>();
      mocks.rpc.mockReturnValue(restore.promise);
      await dom.render();
      await act(async () =>
        dom.container
          .querySelector<HTMLButtonElement>('[aria-label="Read replies aloud"]')!
          .click(),
      );
      const history = dom.container.querySelector('[data-menu="Instruction history"]')!;
      await act(async () => history.querySelector<HTMLButtonElement>("button")!.click());
      const confirm = mocks.alert.mock.calls.at(-1)![2][1].onPress;
      await act(async () => {
        confirm();
        confirm();
      });
      const input = dom.container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Instructions"]',
      )!;
      expect(input.disabled).toBe(true);
      const save = [...dom.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Saving…",
      )!;
      expect(save.disabled).toBe(true);
      await act(async () => save.click());
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (fails) restore.reject(new Error("restore failed"));
        else restore.resolve({ id: "bot-fixture", instructions: "Earlier", color: mocks.color });
      });
      expect(input.disabled).toBe(false);
      expect(input.value).toBe(fails ? "" : "Earlier");
      if (fails) expect(dom.container.textContent).toContain("restore failed");
      expect(mocks.back).not.toHaveBeenCalled();
    },
  );

  it("does not start a restore while Save is in flight", async () => {
    mocks.history = [
      {
        id: "v1",
        instructions: "Earlier",
        reason: "Manual edit",
        createdAt: "2026-10-01T00:00:00Z",
      },
    ];
    const save = deferredSave();
    mocks.rpc.mockReturnValue(save.promise);
    await dom.render();
    const history = dom.container.querySelector('[data-menu="Instruction history"]')!;
    await act(async () => history.querySelector<HTMLButtonElement>("button")!.click());
    const confirm = mocks.alert.mock.calls.at(-1)![2][1].onPress;
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Read replies aloud"]')!.click(),
    );
    const button = [...dom.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Save",
    )!;
    await act(async () => {
      button.click();
      confirm();
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", expect.any(Object));
    await act(async () => save.resolve());
  });

  it("exports through the share sheet and confirms conversation clearing", async () => {
    await dom.render();
    mocks.rpc.mockResolvedValueOnce({ version: 1 });
    const button = (label: string) =>
      [...dom.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === label,
      )!;
    await act(async () => button("Export").click());
    expect(mocks.rpc).toHaveBeenCalledWith("export/bot", { botId: "bot-fixture" });
    expect(mocks.share).toHaveBeenCalledWith({ message: JSON.stringify({ version: 1 }, null, 2) });
    mocks.rpc.mockClear();
    await act(async () => button("Clear conversation").click());
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ ok: true });
    await act(async () => mocks.alert.mock.calls.at(-1)![2][1].onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("threads/clear", { botId: "bot-fixture" });
  });

  it("opens avatar controls from the header and closes the sheet", async () => {
    await dom.render();
    expect(dom.container.textContent).not.toContain("Shape");
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click(),
    );
    expect(dom.container.textContent).toContain("Shape");
    await act(async () =>
      [...dom.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Done")!
        .click(),
    );
    expect(dom.container.textContent).not.toContain("Shape");
  });

  it("expands Advanced for a native model deep link", async () => {
    mocks.focus = "model";
    await act(async () => dom.root.render(<BotSettingsScreen />));
    expect(
      dom.container.querySelector('[aria-label="Advanced"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(dom.container.textContent).toContain("Model");
  });

  it("commits a native profile prompt immediately and leaves cancellation unchanged", async () => {
    mocks.rpc.mockResolvedValue(undefined);
    await act(async () => dom.root.render(<BotSettingsScreen />));
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
    );
    const buttons = mocks.prompt.mock.lastCall![2] as { onPress?: (value?: string) => void }[];
    await act(async () => buttons[1]!.onPress!("Atlas"));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("bots/update", {
      botId: "bot-fixture",
      name: "Atlas",
    });
    expect(dom.container.querySelector('[aria-label="Edit name"]')?.textContent).toBe("Atlas");
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
    );
    const cancel = (mocks.prompt.mock.lastCall![2] as { onPress?: () => void }[])[0]!;
    await act(async () => cancel.onPress?.());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(dom.container.querySelector('[aria-label="Edit name"]')?.textContent).toBe("Atlas");
  });

  it("shows a quiet header with no Save or empty context groups", async () => {
    await act(async () => dom.root.render(<BotSettingsScreen />));
    expect(dom.container.textContent).not.toContain("Open work");
    expect(dom.container.textContent).not.toContain("Memory");
    expect(
      [...dom.container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
    ).toBe(false);
  });

  it("limits open work and memory lists until Show more", async () => {
    mocks.work = Array.from({ length: 7 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      notes: "",
      status: "open",
    }));
    mocks.docs = Array.from({ length: 7 }, (_, i) => ({
      id: `doc-${i}`,
      path: `notes/${i}.md`,
      content: "Fixture notes",
    }));
    await act(async () => dom.root.render(<BotSettingsScreen />));
    expect(dom.container.textContent).not.toContain("Task 6");
    expect(dom.container.textContent).not.toContain("notes/6.md");
    for (const button of [...dom.container.querySelectorAll("button")].filter(
      (node) => node.textContent === "Show more",
    ))
      await act(async () => button.click());
    expect(dom.container.textContent).toContain("Task 6");
    expect(dom.container.textContent).toContain("notes/6.md");
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="notes/6.md"]')!.click(),
    );
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/memory-note",
      params: { id: "doc-6", botId: "bot-fixture" },
    });
  });

  it("uses a dialog rather than inline fields on Android", async () => {
    mocks.os = "android";
    await act(async () => dom.root.render(<BotSettingsScreen />));
    expect(dom.container.querySelector('[aria-label="Name"]')).toBeNull();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
    );
    expect(dom.container.querySelector('[aria-label="Name"]')).not.toBeNull();
    expect(mocks.prompt).not.toHaveBeenCalled();
    await act(async () =>
      [...dom.container.querySelectorAll("button")]
        .find((node) => node.textContent === "Cancel")!
        .click(),
    );
    expect(dom.container.querySelector('[aria-label="Name"]')).toBeNull();
  });

  it("sizes multiline editors from an unconstrained copy of their loaded content", async () => {
    mocks.instructions = "First line\nSecond line\nThird line\nFourth line\nFifth line";
    mocks.description = mocks.instructions;
    await dom.render();
    for (const label of ["Instructions", "How other bots see it"]) {
      const input = dom.container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
      const style = Object.assign({}, ...JSON.parse(input.dataset.style!).flat(Infinity));
      expect(style).toMatchObject({ position: "absolute", top: 0, bottom: 0, lineHeight: 22 });
      expect(input.dataset.scrollEnabled).toBe("false");
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
      const measure = input.previousElementSibling as HTMLElement;
      expect(measure.textContent).toBe(`${mocks.instructions}\u200b`);
      const measureStyle = Object.assign({}, ...JSON.parse(measure.dataset.style!).flat(Infinity));
      expect(measureStyle).toMatchObject({ minHeight: 98, lineHeight: 22, opacity: 0 });
      expect(measureStyle.height).toBeUndefined();
      expect(measureStyle.maxHeight).toBeUndefined();
      expect(style.padding).toBe(measureStyle.padding);
      await act(async () => {
        (input as HTMLTextAreaElement).value = "Short";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(measure.textContent).toBe("Short\u200b");
      await act(async () => {
        (input as HTMLTextAreaElement).value = "Line\n".repeat(20);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(measure.textContent).toBe(`${"Line\n".repeat(20)}\u200b`);
    }
  });

  it("hides advanced controls until expanded and follows the shared order", async () => {
    await act(async () => dom.root.render(<BotSettingsScreen />));
    for (const label of [
      "Model",
      "Thinking",
      "Computer",
      "Read replies aloud",
      "Device voice",
      "Manage other bots",
      "Instructions",
    ]) {
      expect(dom.container.textContent).not.toContain(label);
    }
    const trigger = dom.container.querySelector<HTMLButtonElement>('[aria-label="Advanced"]')!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("role")).toBe("button");
    expect(JSON.parse(trigger.dataset.style!)).toMatchObject({ marginTop: 24, minHeight: 44 });
    const headings = [...dom.container.querySelectorAll<HTMLElement>('[role="header"]')];
    expect(headings.map((heading) => heading.textContent)).toEqual(["Notifications"]);
    expect(trigger.querySelector('[data-ios="chevron.right"]')).not.toBeNull();
    expect(dom.container.querySelector('[aria-label="Instructions"]')).toBeNull();
    await dom.expand();
    expect(dom.container.querySelector('[aria-label="Instructions"]')).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.querySelector('[data-ios="chevron.down"]')).not.toBeNull();
    expect(JSON.parse((trigger.nextElementSibling as HTMLElement).dataset.style!)).toMatchObject({
      gap: 24,
      marginTop: 24,
    });
    const labels = {
      instructions: "Instructions",
      computer: "Computer",
      model: "Model",
      readAloud: "Read replies aloud",
      voice: "Device voice",
      dailyCheckIns: "Daily check-ins on unfinished work",
      crossSpaceCommunication: "Allow cross-space bot communication",
      fleetManagement: "Manage other bots",
    };
    const actual = [...dom.container.querySelectorAll("span")].flatMap((span) =>
      Object.entries(labels)
        .filter(
          ([key, label]) =>
            label === span.textContent &&
            (span.getAttribute("role") !== "header" || key === "model"),
        )
        .map(([key]) => key),
    );
    expect(actual).toEqual(
      Object.values(BOT_SETTINGS_SECTIONS)
        .flat()
        .filter((key) => key in labels && key !== "instructions" && key !== "computer"),
    );
    expect(actual).toEqual([
      "model",
      "readAloud",
      "voice",
      "dailyCheckIns",
      "crossSpaceCommunication",
      "fleetManagement",
    ]);

    await dom.expand();
    expect(dom.container.textContent).not.toContain("Read replies aloud");
  });

  it("propagates each saved notification choice from chat settings only after the save succeeds", async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: "direct-chat",
          content: { data: { botId: "bot-fixture", threadId: "thread-fixture" } },
        },
      },
      {
        request: {
          identifier: "group-chat",
          content: { data: { botId: "bot-fixture", threadId: "group-thread", groupId: "group" } },
        },
      },
    ] as never);
    const first = deferredSave<{ threadId: string }>();
    mocks.rpc.mockReturnValueOnce(first.promise);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="When it finishes or needs input"]',
    )!;
    await act(async () => toggle.click());
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      notifyOnFinish: false,
    });
    expect(afterChatNotifyChange).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    await act(async () => first.resolve({ threadId: "thread-fixture" }));
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledExactlyOnceWith("direct-chat");
    expect(afterChatNotifyChange).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test",
      "token",
      "space-a",
      { botId: "bot-fixture", threadId: "thread-fixture", notify: false },
    );

    mocks.rpc.mockResolvedValueOnce({ threadId: "thread-fixture" });
    await act(async () => toggle.click());
    expect(vi.mocked(afterChatNotifyChange).mock.calls).toEqual([
      [
        "https://api.example.test",
        "token",
        "space-a",
        { botId: "bot-fixture", threadId: "thread-fixture", notify: false },
      ],
      [
        "https://api.example.test",
        "token",
        "space-a",
        { botId: "bot-fixture", threadId: "thread-fixture", notify: true },
      ],
    ]);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("dismisses direct-chat notifications when muting before the bot loads", async () => {
    const loading = deferredSave();
    mocks.loadBot.mockReturnValueOnce(loading.promise);
    mocks.rpc.mockResolvedValueOnce({ threadId: "thread-fixture" });
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      {
        request: {
          identifier: "direct-chat",
          content: { data: { "robots.botId": "bot-fixture", "robots.threadId": "thread-fixture" } },
        },
      },
      {
        request: {
          identifier: "group-chat",
          content: { data: { "robots.botId": "bot-fixture", "robots.threadId": "group-thread" } },
        },
      },
    ] as never);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="When it finishes or needs input"]',
    )!;
    await act(async () => toggle.click());
    expect(mocks.rpc).toHaveBeenCalledWith("bots/update", {
      botId: "bot-fixture",
      notifyOnFinish: false,
    });
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledExactlyOnceWith("direct-chat");
    expect(afterChatNotifyChange).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test",
      "token",
      "space-a",
      { botId: "bot-fixture", threadId: "thread-fixture", notify: false },
    );
    await act(async () => loading.resolve());
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("does not propagate a notification change when saving from chat settings fails", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="When it finishes or needs input"]',
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(afterChatNotifyChange).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    expect(dom.container.textContent).toContain("offline");
  });

  it("queues notifications and ignores an older failure before saving the latest choice", async () => {
    const first = deferredSave();
    mocks.rpc.mockReturnValueOnce(first.promise);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="When it finishes or needs input"]',
    )!;
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ threadId: "thread-fixture" });
    await act(async () => first.reject(new Error("older failure")));
    expect(mocks.rpc).toHaveBeenLastCalledWith("bots/update", {
      botId: "bot-fixture",
      notifyOnFinish: false,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(dom.container.textContent).not.toContain("older failure");
    mocks.rpc.mockRejectedValueOnce(new Error("latest failure"));
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(dom.container.textContent).toContain("latest failure");
  });

  it.each([
    { firstFails: false, latestFails: false },
    { firstFails: true, latestFails: false },
    { firstFails: false, latestFails: true },
    { firstFails: true, latestFails: true },
  ])(
    "serializes name edits (first fails: $firstFails, latest fails: $latestFails)",
    async ({ firstFails, latestFails }) => {
      const first = deferredSave();
      const last = deferredSave();
      mocks.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
      await dom.render();
      const edit = async (value: string) => {
        await act(async () =>
          dom.container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
        );
        const buttons = mocks.prompt.mock.calls.at(-1)![2];
        await act(async () =>
          buttons.find((button: { text: string }) => button.text === "Save").onPress(value),
        );
      };
      await edit("First");
      await edit("Latest");
      expect(mocks.rpc.mock.calls).toEqual([
        ["bots/update", { botId: "bot-fixture", name: "First" }],
      ]);
      expect(dom.container.textContent).toContain("Latest");
      await act(async () => {
        if (firstFails) first.reject(new Error("older failure"));
        else first.resolve();
      });
      expect(dom.container.textContent).not.toContain("older failure");
      expect(mocks.rpc).toHaveBeenLastCalledWith("bots/update", {
        botId: "bot-fixture",
        name: "Latest",
      });
      expect(dom.container.textContent).toContain("Latest");
      await act(async () => {
        if (latestFails) last.reject(new Error("latest failure"));
        else last.resolve();
      });
      const shown = dom.container.querySelector('[aria-label="Edit name"]')!;
      expect(shown.textContent).toBe(latestFails ? (firstFails ? "Fixture" : "First") : "Latest");
      expect(
        [...dom.container.querySelectorAll("button")].some((node) => node.textContent === "Save"),
      ).toBe(false);
    },
  );

  it("saves read aloud and computer mode after expanding Advanced", async () => {
    mocks.rpc.mockResolvedValue(undefined);
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Read replies aloud"]')!.click(),
    );
    await act(async () =>
      [...dom.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Private")!
        .click(),
    );
    await act(async () =>
      [...dom.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("bots/setComputer", {
      botId: "bot-fixture",
      mode: "dedicated",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "bots/update",
      expect.objectContaining({ botId: "bot-fixture", autoSpeak: true }),
    );
  });

  it("persists bot management toggles immediately without adding them to unrelated saves", async () => {
    mocks.rpc.mockResolvedValue(undefined);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage other bots"]',
    );
    if (!toggle) throw new Error("Missing bot management switch");
    await act(async () => {
      toggle.click();
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("bots/update", {
      botId: "bot-fixture",
      fleetManagement: true,
    });
    mocks.rpc.mockClear();
    const save = [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    if (!save) {
      expect(dom.container.querySelector('[aria-label="Save"]')).toBeNull();
      return;
    }
    await act(async () => {
      save.click();
    });
    for (const [, input] of mocks.rpc.mock.calls)
      expect(input).not.toHaveProperty("fleetManagement");
  });

  it("keeps the switch and Save enabled while saving and coalesces rapid toggles", async () => {
    const first = deferredSave();
    const last = deferredSave();
    mocks.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage other bots"]',
    )!;
    const save = [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(false);
    expect(save).toBeUndefined();
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve());
    expect(mocks.rpc.mock.calls).toEqual([
      ["bots/update", { botId: "bot-fixture", fleetManagement: true }],
      ["bots/update", { botId: "bot-fixture", fleetManagement: false }],
    ]);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => last.reject(new Error("latest save failed")));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(dom.container.textContent).toContain("latest save failed");
    expect(toggle.disabled).toBe(false);
  });

  it.each([false, true])(
    "waits for the full bot management queue before leaving (failure: %s)",
    async (fails) => {
      const first = deferredSave();
      const last = deferredSave();
      let fleetCalls = 0;
      mocks.rpc.mockImplementation((_procedure: string, input: { fleetManagement?: boolean }) =>
        input.fleetManagement === undefined
          ? Promise.resolve(undefined)
          : ++fleetCalls === 1
            ? first.promise
            : last.promise,
      );
      await dom.render();
      const toggle = dom.container.querySelector<HTMLButtonElement>(
        '[aria-label="Manage other bots"]',
      )!;
      await act(async () =>
        dom.container
          .querySelector<HTMLButtonElement>('[aria-label="Read replies aloud"]')!
          .click(),
      );
      const save = [...dom.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Save",
      )!;
      await act(async () => toggle.click());
      await act(async () => save.click());
      expect(mocks.back).not.toHaveBeenCalled();
      expect(toggle.disabled).toBe(false);
      await act(async () => toggle.click());
      await act(async () => first.resolve());
      expect(mocks.back).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledTimes(3);
      await act(async () => {
        if (fails) last.reject(new Error("bot management write failed"));
        else last.resolve();
      });
      if (fails) {
        expect(mocks.back).not.toHaveBeenCalled();
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        expect(dom.container.textContent).toContain("bot management write failed");
        expect(toggle.disabled).toBe(false);
      } else {
        expect(mocks.back).toHaveBeenCalledOnce();
      }
    },
  );

  it("keeps a failed bot management write visible without an unrelated Save", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    await dom.render();
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Manage other bots"]')!.click(),
    );
    expect(
      [...dom.container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
    ).toBe(false);
    expect(mocks.back).not.toHaveBeenCalled();
    expect(dom.container.textContent).toContain("offline");
  });

  it("does not resend saved edits when Save is retried after a failed bot management write", async () => {
    mocks.rpc.mockResolvedValue(undefined);
    mocks.rpc.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      instructions: "",
      autoSpeak: true,
      instructionHistory: [
        { id: "v1", instructions: "Older", reason: "edit", createdAt: "2026-10-21T18:00:00Z" },
      ],
    });
    await dom.render();
    expect(dom.container.querySelector('[data-menu="Instruction history"]')).toBeNull();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage other bots"]',
    )!;
    await act(async () => toggle.click());
    await act(async () =>
      dom.container.querySelector<HTMLButtonElement>('[aria-label="Read replies aloud"]')!.click(),
    );
    const save = [...dom.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;
    await act(async () => save.click());
    expect(mocks.rpc).toHaveBeenLastCalledWith("bots/update", {
      botId: "bot-fixture",
      autoSpeak: true,
    });
    expect(mocks.back).not.toHaveBeenCalled();
    expect(dom.container.textContent).toContain("offline");
    expect(dom.container.querySelector('[data-menu="Instruction history"]')).not.toBeNull();
    await act(async () => toggle.click());
    mocks.rpc.mockClear();
    expect(
      [...dom.container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
    ).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("coalesces a queued value matching the confirmed save", async () => {
    const first = deferredSave();
    mocks.rpc.mockReturnValueOnce(first.promise);
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage other bots"]',
    )!;
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await act(async () => first.resolve());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("restores the bot management toggle when saving fails", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    await dom.render();
    const toggle = dom.container.querySelector<HTMLButtonElement>(
      '[aria-label="Manage other bots"]',
    );
    if (!toggle) throw new Error("Missing bot management switch");
    await act(async () => {
      toggle.click();
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("bots/update", {
      botId: "bot-fixture",
      fleetManagement: true,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false);
    expect(dom.container.textContent).toContain("offline");
  });

  it("marks the current voice, keeps the plain row, and saves before playing a sample", async () => {
    await dom.render();
    const actions = dom.menu()!.querySelectorAll("button");
    expect([...actions].map((action) => [action.textContent, action.dataset.state])).toEqual([
      ["Alice (en-US)", "on"],
      ["Beth (en-GB)", "off"],
    ]);
    const labels = [...dom.container.querySelectorAll("span")];
    const label = (text: string) => labels.find((item) => item.textContent === text)!;
    const style = (node: HTMLElement) =>
      Object.assign({}, ...[JSON.parse(node.dataset.style!)].flat(Infinity));
    expect(style(label("Device voice"))).toEqual(style(label("Read replies aloud")));
    const row = dom.menu()!.firstElementChild as HTMLElement;
    expect(row.contains(label("Device voice"))).toBe(true);
    const trigger = row.firstElementChild!;
    expect(trigger.getAttribute("role")).toBe("button");
    expect(trigger.getAttribute("aria-label")).toBe("Device voice");
    expect(trigger.getAttribute("aria-valuetext")).toBe("Alice (en-US)");
    expect(trigger.contains(label("Alice (en-US)"))).toBe(true);
    expect(dom.menu()!.querySelector("i")!.dataset).toMatchObject({
      ios: "chevron.up.chevron.down",
      android: "chevron-expand",
    });
    await act(async () =>
      mocks.layouts.get(dom.menu()!.parentElement!)!({ nativeEvent: { layout: { width: 320 } } }),
    );
    expect(JSON.parse(row.dataset.style!).at(-1)).toEqual({ width: 320 });
    await act(async () => actions[1]!.click());
    expect(mocks.setVoiceForBot).toHaveBeenCalledWith("bot-fixture", "voice-b");
    expect(mocks.stopVoicePlayback).toHaveBeenCalledOnce();
    expect(mocks.speak).toHaveBeenCalledWith("Hi, I'm Fixture.", { voice: "voice-b" });
    expect(mocks.setVoiceForBot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.speak.mock.invocationCallOrder[0]!,
    );
    expect(
      [...dom.menu()!.querySelectorAll("button")].map((action) => action.dataset.state),
    ).toEqual(["off", "on"]);
  });

  it("restores the checkmark and skips the sample when saving fails", async () => {
    mocks.setVoiceForBot.mockRejectedValueOnce(new Error("Save failed"));
    await dom.render();
    await act(async () => dom.menu()!.querySelectorAll("button")[1]!.click());
    expect(dom.menu()!.querySelector("button")!.dataset.state).toBe("on");
    expect(dom.container.textContent).toContain("Could not save that voice");
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it.each([
    { firstSucceeds: false, latestSucceeds: true },
    { firstSucceeds: false, latestSucceeds: false },
    { firstSucceeds: true, latestSucceeds: false },
    { firstSucceeds: true, latestSucceeds: true },
  ])(
    "keeps overlapping choices consistent (first saves: $firstSucceeds, latest saves: $latestSucceeds)",
    async ({ firstSucceeds, latestSucceeds }) => {
      mocks.deviceVoices.mockResolvedValue([
        ...offered,
        { identifier: "voice-c", name: "Clara", language: "en-US" },
      ]);
      const first = deferredSave();
      const latest = deferredSave();
      mocks.setVoiceForBot.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
      await dom.render();
      const actions = () => [...dom.menu()!.querySelectorAll("button")];
      await act(async () => actions()[1]!.click());
      await act(async () => actions()[2]!.click());
      expect(mocks.setVoiceForBot.mock.calls).toEqual([
        ["bot-fixture", "voice-b"],
        ["bot-fixture", "voice-c"],
      ]);

      await act(async () => {
        if (firstSucceeds) first.resolve();
        else first.reject(new Error("First save failed"));
      });
      expect(actions().map((action) => action.dataset.state)).toEqual(["off", "off", "on"]);
      expect(dom.container.textContent).not.toContain("Could not save that voice");
      expect(mocks.speak).not.toHaveBeenCalled();

      await act(async () => {
        if (latestSucceeds) latest.resolve();
        else latest.reject(new Error("Latest save failed"));
      });
      const savedIndex = latestSucceeds ? 2 : firstSucceeds ? 1 : 0;
      expect(actions().map((action) => action.dataset.state)).toEqual(
        [0, 1, 2].map((index) => (index === savedIndex ? "on" : "off")),
      );
      if (latestSucceeds) {
        expect(dom.container.textContent).not.toContain("Could not save that voice");
        expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("Hi, I'm Fixture.", {
          voice: "voice-c",
        });
      } else {
        expect(dom.container.textContent).toContain("Could not save that voice");
        expect(mocks.speak).not.toHaveBeenCalled();
      }
    },
  );

  it.each([{ voices: [] }, { voices: offered.slice(0, 1) }])(
    "shows a plain row without a menu for $voices.length voices",
    async ({ voices }) => {
      mocks.deviceVoices.mockResolvedValue(voices);
      await dom.render();
      expect(dom.menu()).toBeNull();
      const row = dom.container.querySelector<HTMLElement>('[aria-label="Device voice"]')!;
      expect(row.tagName).toBe("DIV");
      expect(row.getAttribute("role")).toBeNull();
      expect(row.lastElementChild!.tagName).toBe("SPAN");
      expect(row.lastElementChild!.textContent).toBe(row.getAttribute("aria-valuetext"));
      expect(row.querySelector('i[data-ios="chevron.up.chevron.down"]')).toBeNull();
    },
  );

  it("keeps a destructive retry row after failure and replaces it with a menu on success", async () => {
    mocks.deviceVoices.mockRejectedValueOnce(new Error("Load failed"));
    await dom.render();
    expect(dom.menu()).toBeNull();
    expect(
      dom.container
        .querySelector('[aria-label="Device voice"]')!
        .querySelector('i[data-ios="chevron.up.chevron.down"]'),
    ).toBeNull();
    const retry = () =>
      [...dom.container.querySelectorAll("button")].find((item) =>
        item.textContent?.includes("Could not load voices"),
      )!;
    expect(retry().querySelectorAll("span")[1]!.dataset.style).toContain('"color":"error"');
    mocks.deviceVoices.mockRejectedValueOnce(new Error("Still unavailable"));
    await act(async () => retry().click());
    expect(dom.menu()).toBeNull();
    await act(async () => retry().click());
    expect(dom.menu()).not.toBeNull();
    expect(dom.container.textContent).not.toContain("Could not load voices");
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("preserves Model/Thinking menus and their empty default choice", async () => {
    const onChange = vi.fn();
    const props: ComponentProps<typeof MenuPicker> = {
      label: "Model",
      choices: [
        { key: "", label: "Default" },
        { key: "model-a", label: "Model A" },
      ],
      value: "model-a",
      onChange,
    };
    await act(async () => dom.root.render(<MenuPicker {...props} />));
    const actions = dom.container.querySelectorAll("button");
    expect(actions[1]!.dataset.state).toBe("on");
    await act(async () => actions[0]!.click());
    expect(onChange).toHaveBeenCalledWith("");
    expect(dom.container.querySelector("i")!.dataset.ios).toBe("chevron.up.chevron.down");
  });

  it.each([false, true])(
    "sizes the menu trigger to its measured width (plain=%s)",
    async (plain) => {
      await act(async () =>
        dom.root.render(
          <MenuPicker
            choices={[{ key: "", label: "Space default" }]}
            divider
            label="Model"
            onChange={vi.fn()}
            plain={plain}
            value=""
          />,
        ),
      );
      const nativeMenu = dom.container.querySelector<HTMLElement>('[data-menu="Model"]')!;
      const trigger = nativeMenu.firstElementChild as HTMLElement;
      const triggerStyle = () => Object.assign({}, ...JSON.parse(trigger.dataset.style!).flat());
      expect(triggerStyle()).toMatchObject({ alignSelf: "stretch" });
      expect(triggerStyle().width).toBeUndefined();
      expect(JSON.parse(nativeMenu.dataset.style!)).toEqual({ alignSelf: "stretch" });
      for (const width of [320, 480]) {
        await act(async () =>
          mocks.layouts.get(nativeMenu.parentElement!)!({ nativeEvent: { layout: { width } } }),
        );
        expect(triggerStyle().width).toBe(width);
      }
    },
  );
});

it("opens a native name prompt from the centred header", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<BotSettingsScreen />));
  expect(host.querySelector('[placeholder="Name this bot"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click());
  expect(mocks.prompt).toHaveBeenCalledWith(
    "Name",
    undefined,
    expect.any(Array),
    "plain-text",
    "Fixture",
  );
  await act(async () => root.unmount());
});

it.each(["  \n", "# Fixture\n\n"])("hides empty memory: %j", async (content) => {
  mocks.docs = [{ id: "empty", path: "MEMORY.md", content }];
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BotSettingsScreen />));
    expect(host.textContent).not.toContain("MEMORY.md");
  } finally {
    await act(async () => root.unmount());
  }
});
