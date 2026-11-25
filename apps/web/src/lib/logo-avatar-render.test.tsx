// @vitest-environment jsdom
import type { ProductEvent } from "@robots/contracts";
import { BotAvatar, BotAvatarActivityProvider } from "@robots/ui-web";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webLogoAvatarActivity } from "./logo-avatar-activity";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  webLogoAvatarActivity.clear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  webLogoAvatarActivity.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const snapshot = {
  threadId: "thread-a",
  cursor: 0,
  botId: "bot-a",
  run: { id: "run-a", botId: "bot-a", status: "running" as const, trigger: "user" as const },
};
const event = (
  seq: number,
  type: ProductEvent["type"],
  payload: ProductEvent["payload"] = {},
  runId = "run-a",
): ProductEvent => ({
  id: `event-${seq}`,
  spaceId: "space-a",
  threadId: "thread-a",
  seq,
  botId: "bot-a",
  runId,
  type,
  payload,
  createdAt: "2026-10-01T00:00:00Z",
});
async function mount(status?: string) {
  await act(async () =>
    root.render(
      <BotAvatarActivityProvider source={webLogoAvatarActivity}>
        <div data-testid="live">
          <BotAvatar identity="bot-a" color="#10B981" avatarSet="robots" status={status} />
        </div>
        <div data-testid="legacy">
          <BotAvatar identity="old-bot" color="#8B5CF6" />
        </div>
        <div data-testid="photo">
          <BotAvatar identity="photo" color="data:image/png;base64,YQ==" avatarSet="robots" />
        </div>
        <div data-testid="shape">
          <BotAvatar identity="shape" color="#8B5CF6::shape_2" avatarSet="robots" />
        </div>
      </BotAvatarActivityProvider>,
    ),
  );
}
const picture = (testId: string) =>
  container.querySelector<HTMLImageElement>(
    `[data-testid="${testId}"] .robots-bot-avatar-picture img`,
  );
const avatar = (testId: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"] .robots-bot-avatar`);
it("draws every bot as a robot picture and never subscribes to feed activity", async () => {
  const subscribe = vi.spyOn(webLogoAvatarActivity, "subscribe");
  await mount();
  for (const testId of ["live", "legacy", "shape"]) {
    expect(picture(testId)!.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  }
  expect(picture("photo")!.getAttribute("src")).toBe("data:image/png;base64,YQ==");
  expect(container.querySelector(".robots-logo-avatar")).toBeNull();
  expect(container.querySelector(".robots-organic-avatar")).toBeNull();
  await act(async () => webLogoAvatarActivity.hydrate("chat", snapshot));
  await act(async () =>
    webLogoAvatarActivity.apply("chat", event(1, "agent.tool.called", { name: "read_file" })),
  );
  expect(subscribe).not.toHaveBeenCalled();
  expect(avatar("live")!.dataset.working).toBe("false");
});
it("lights the working ring from the status alone, through hydration, hidden tabs and reconnect", async () => {
  await mount("running");
  expect(avatar("live")!.dataset.working).toBe("true");
  expect(
    container.querySelector('[data-testid="live"] .robots-bot-avatar-ring-working'),
  ).not.toBeNull();
  await act(async () => {
    webLogoAvatarActivity.hydrate("chat", snapshot);
    webLogoAvatarActivity.apply(
      "chat",
      event(1, "agent.tool.called", { name: "read_file", executionId: "read" }),
    );
  });
  expect(avatar("live")!.dataset.working).toBe("true");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(avatar("live")!.dataset.working).toBe("true");
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => {
    webLogoAvatarActivity.resetSource("chat");
    webLogoAvatarActivity.hydrate("reconnect", { ...snapshot, cursor: 2 });
  });
  expect(avatar("live")!.dataset.working).toBe("true");
  expect(avatar("legacy")!.dataset.working).toBe("false");
});

it("keeps the same robot picture mounted through rapid status changes", async () => {
  const render = (status: string) =>
    act(async () =>
      root.render(
        <BotAvatarActivityProvider source={webLogoAvatarActivity}>
          <BotAvatar
            identity="bot-a"
            color="#10B981"
            avatarSet="robots"
            size={22}
            status={status}
          />
        </BotAvatarActivityProvider>,
      ),
    );
  await render("running");
  const image = container.querySelector(".robots-bot-avatar-picture img");
  expect(image).not.toBeNull();
  for (let step = 1; step <= 40; step++) {
    await render(step % 2 === 0 ? "running" : "idle");
    expect(container.querySelector(".robots-bot-avatar")!.getAttribute("data-working")).toBe(
      String(step % 2 === 0),
    );
    expect(container.querySelector(".robots-bot-avatar-picture img")).toBe(image);
    expect(container.querySelectorAll(".robots-bot-avatar-picture")).toHaveLength(1);
  }
});

it("shows work from the status elsewhere even when the open chat is idle", async () => {
  await mount("running");
  await act(async () =>
    webLogoAvatarActivity.hydrate("dm", { threadId: "dm", cursor: 0, botId: "bot-a", run: null }),
  );
  expect(avatar("live")!.dataset.working).toBe("true");
  await act(async () => {
    webLogoAvatarActivity.hydrate("group", snapshot);
    webLogoAvatarActivity.apply(
      "group",
      event(1, "agent.tool.called", { name: "read_file", executionId: "read" }),
    );
  });
  expect(avatar("live")!.dataset.working).toBe("true");
  await act(async () => webLogoAvatarActivity.resetSource("group"));
  expect(avatar("live")!.dataset.working).toBe("true");
  await mount("idle");
  expect(avatar("live")!.dataset.working).toBe("false");
});
