// @vitest-environment jsdom

import type * as UiWeb from "@robots/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  boards: { subscribe: vi.fn() },
  bots: { list: vi.fn() },
  tickets: {
    list: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    comment: vi.fn(),
    comments: vi.fn(),
  },
}));
vi.mock("../../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("../../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));
vi.mock("./WorkspaceLayout", () => ({
  WorkspaceLayout: ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@robots/chat-ui/web", () => ({ ChatMarkdown: () => null }));
vi.mock("@robots/ui-web", async (importOriginal) => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BotAvatar: ({ identity }: { identity: string }) => <i data-avatar={identity} />,
    Button: (props: ComponentProps<"button"> & { variant?: string; size?: string }) => {
      const { variant: _variant, size: _size, ...rest } = props;
      return <button type="button" {...rest} />;
    },
    buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
    SectionHeading: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Dialog: Container,
    DialogContent: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  };
});

import { TasksPage } from "./TasksPage";

function ticket(id: string, status: string, assigneeBotId: string | null = "bot-1", minute = 0) {
  const at = new Date(Date.UTC(2026, 10, 15, 9, minute)).toISOString();
  return {
    id,
    boardId: "board-1",
    spaceId: "space-1",
    number: 1,
    ref: `RAK-${id}`,
    title: `Title ${id}`,
    description: null,
    status,
    priority: "normal",
    assigneeBotId,
    createdByBotId: null,
    createdByUserId: null,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
  };
}

let cleanup: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.boards.subscribe.mockReset().mockResolvedValue({
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  });
  api.bots.list.mockResolvedValue([{ id: "bot-1", name: "Helper", color: "#000" }]);
  api.tickets.move.mockReset().mockResolvedValue({});
  api.tickets.comments.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function render(tickets: ReturnType<typeof ticket>[], path = "/app/tasks") {
  api.tickets.list.mockReset().mockResolvedValue({ tickets });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <TasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

const column = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="task-column-${id}"]`)!;
const cardIds = (container: HTMLElement, id: string) =>
  Array.from(column(container, id).querySelectorAll("[data-testid^='task-card-']")).map((card) =>
    card.getAttribute("data-testid")!.replace("task-card-", ""),
  );

function drag(type: string, target: Element, ticketId: string) {
  const data = new Map([["text/plain", ticketId]]);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: [...data.keys()],
      getData: (key: string) => data.get(key) ?? "",
      setData: (key: string, value: string) => data.set(key, value),
      dropEffect: "none",
      effectAllowed: "all",
    },
  });
  target.dispatchEvent(event);
  return event;
}

it("groups tickets into the four columns with assignee and time on each card", async () => {
  const container = await render([
    ticket("1", "todo"),
    ticket("2", "review"),
    ticket("3", "blocked", null),
    ticket("4", "doing"),
    ticket("5", "done"),
    ticket("6", "closed"),
  ]);
  expect(Array.from(container.querySelectorAll("h2")).map((node) => node.textContent)).toEqual([
    "Not started 1",
    "Needs you 2",
    "Working on it 1",
    "Done 1",
  ]);
  expect(cardIds(container, "needsYou").sort()).toEqual(["2", "3"]);
  const card = container.querySelector('[data-testid="task-card-1"]')!;
  expect(card.textContent).toContain("RAK-1");
  expect(card.textContent).toContain("Title 1");
  expect(card.textContent).toContain("Helper");
  expect(card.textContent).toContain("5m ago");
  expect(card.querySelector("[data-avatar='bot-1']")).not.toBeNull();
  expect(container.querySelector('[data-testid="task-card-3"]')!.textContent).toContain(
    "Unassigned",
  );

  const showClosed = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Show closed",
  )!;
  await act(async () => showClosed.click());
  expect(cardIds(container, "done").sort()).toEqual(["5", "6"]);
});

it("shows four cards per column until Show all", async () => {
  const container = await render(
    ["a", "b", "c", "d", "e", "f"].map((id, index) => ticket(id, "todo", "bot-1", index)),
  );
  expect(cardIds(container, "notStarted")).toEqual(["f", "e", "d", "c"]);
  const showAll = Array.from(column(container, "notStarted").querySelectorAll("button")).find(
    (button) => button.textContent?.startsWith("Show all 6"),
  )!;
  await act(async () => showAll.click());
  expect(cardIds(container, "notStarted")).toHaveLength(6);
});

it("moves a dropped card to the column's first status", async () => {
  const container = await render([ticket("1", "todo"), ticket("2", "blocked")]);
  let answer: (value: unknown) => void = () => undefined;
  api.tickets.move.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
  const card = container.querySelector('[data-testid="task-card-1"]')!;
  const needsYou = column(container, "needsYou");
  await act(async () => {
    drag("dragstart", card, "1");
    expect(drag("dragover", needsYou, "1").defaultPrevented).toBe(true);
    drag("drop", needsYou, "1");
  });
  expect(api.tickets.move).toHaveBeenCalledWith({ id: "1", status: "review" });
  // Shown where it was dropped while the move saves.
  expect(cardIds(container, "needsYou")).toContain("1");

  api.tickets.list.mockResolvedValue({ tickets: [ticket("1", "review"), ticket("2", "blocked")] });
  await act(async () => answer({}));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(api.tickets.list.mock.calls.length).toBeGreaterThan(1);
  expect(cardIds(container, "needsYou").sort()).toEqual(["1", "2"]);

  api.tickets.move.mockClear();
  await act(async () => {
    drag("drop", needsYou, "2");
  });
  expect(api.tickets.move).not.toHaveBeenCalled();
});

it("opens the ticket named in the address", async () => {
  const container = await render([ticket("1", "review")], "/app/tasks?ticket=1");
  expect(container.querySelector('[data-testid="ticket-comments"]')).not.toBeNull();
  expect(container.querySelector("input")?.value).toBe("Title 1");
});
