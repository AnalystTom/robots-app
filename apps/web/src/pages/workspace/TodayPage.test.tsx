// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const never = () => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
});
const api = vi.hoisted(() => ({
  me: vi.fn(),
  bots: { list: vi.fn() },
  groups: { list: vi.fn() },
  runs: { list: vi.fn() },
  today: { runs: vi.fn() },
  notifications: { subscribe: vi.fn() },
  boards: { subscribe: vi.fn() },
  tickets: { list: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
const pages = vi.hoisted(() => ({ tasks: true }));
vi.mock("./workspace-pages", () => ({
  useWorkspacePages: () => (pages.tasks ? [{ id: "today" }, { id: "tasks" }] : [{ id: "today" }]),
}));
vi.mock("./WorkspaceLayout", () => ({
  WorkspaceLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@lingui/react/macro", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@robots/ui-web", () => ({
  BotAvatar: ({ identity }: { identity: string }) => <i data-avatar={identity} />,
  SectionHeading: ({
    children,
    as: Tag = "h3",
    ...props
  }: ComponentProps<"h3"> & { as?: "h2" | "h3" }) => <Tag {...props}>{children}</Tag>,
}));

import { TodayPage } from "./TodayPage";

function run(runId: string, botId: string, botName: string, status: string) {
  return {
    runId,
    botId,
    botName,
    groupId: null,
    groupName: null,
    threadId: `thread-${botId}`,
    status,
    trigger: "user",
    notificationsEnabled: true,
    promptSnippet: `Prompt ${runId}`,
    agentMessage: null,
    updatedAt: new Date().toISOString(),
  };
}
const bot = (id: string, name: string) => ({ id, name, color: "#000", unread: false });

let location = "";
function Location() {
  location = `${useLocation().pathname}${useLocation().search}`;
  return null;
}

let cleanup: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pages.tasks = true;
  api.me.mockResolvedValue({ name: "Ada Lovelace" });
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper"), bot("bot-2", "Scout")]);
  api.groups.list.mockResolvedValue([]);
  api.runs.list.mockImplementation(async ({ filter }: { filter: string }) => ({
    runs:
      filter === "active"
        ? [
            run("run-1", "bot-1", "Helper", "running"),
            run("run-2", "bot-2", "Scout", "waiting_input"),
          ]
        : [],
  }));
  api.today.runs.mockResolvedValue({
    runs: [run("run-3", "bot-1", "Helper", "completed")],
    finished: 3,
  });
  api.notifications.subscribe.mockReset().mockResolvedValue(never());
  api.boards.subscribe.mockReset().mockResolvedValue(never());
  api.tickets.list.mockReset().mockResolvedValue({
    tickets: [
      {
        id: "t-1",
        ref: "RAK-1",
        title: "Approve copy",
        status: "review",
        assigneeBotId: "bot-1",
        updatedAt: "",
      },
      {
        id: "t-2",
        ref: "RAK-2",
        title: "Write",
        status: "doing",
        assigneeBotId: "bot-1",
        updatedAt: "",
      },
    ],
  });
});
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/today"]}>
          <TodayPage />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, client };
}

const summary = (container: HTMLElement) =>
  container.querySelector('[data-testid="today-summary"]')?.textContent?.trim();

it("greets the user and sums up work, what needs them and today's runs", async () => {
  const { container } = await render();
  expect(container.querySelector("h2")?.textContent).toMatch(
    /^Good (morning|afternoon|evening), Ada$/,
  );
  expect(summary(container)).toBe(
    "Helper is working, 2 things need you. Your bots finished 3 runs today.",
  );
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  expect(api.today.runs).toHaveBeenCalledWith(
    { since: startOfToday.toISOString() },
    expect.anything(),
  );
  const needsYou = container.querySelector('[aria-labelledby="today-needs-you"]')!;
  expect(needsYou.textContent).toContain("Approve copy");
  expect(needsYou.textContent).toContain("Scout");
  expect(needsYou.textContent).not.toContain("Write");
  const soFar = container.querySelector('[aria-labelledby="today-so-far"]')!;
  expect(soFar.textContent).toContain("Prompt run-3");
});

it("opens the ticket or chat an item is about", async () => {
  const { container } = await render();
  await act(async () =>
    (container.querySelector('[data-testid="today-ticket-t-1"]') as HTMLButtonElement).click(),
  );
  expect(location).toBe("/app/tasks?ticket=t-1");
  const scout = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[aria-labelledby="today-needs-you"] button'),
  ).find((button) => button.textContent?.includes("Scout"))!;
  await act(async () => scout.click());
  expect(location).toBe("/app/bot-2");
});

it("leaves tickets out when the board is off", async () => {
  pages.tasks = false;
  const { container } = await render();
  expect(api.tickets.list).not.toHaveBeenCalled();
  expect(api.boards.subscribe).not.toHaveBeenCalled();
  expect(summary(container)).toBe(
    "Helper is working, 1 thing needs you. Your bots finished 3 runs today.",
  );
});

it("reads runs again when the server signals a change", async () => {
  let deliver: (frame: { type: string }) => void = () => undefined;
  api.notifications.subscribe.mockResolvedValue({
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          deliver = (value) => resolve({ done: false, value });
        }),
    }),
  });
  const { container } = await render();
  api.today.runs.mockResolvedValue({ runs: [], finished: 0 });
  api.runs.list.mockResolvedValue({ runs: [] });
  await act(async () => deliver({ type: "runs" }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  // The ticket in review still needs the user.
  expect(summary(container)).toBe("No bots are working, 1 thing needs you.");
  expect(container.textContent).toContain("Nothing yet today.");
});
