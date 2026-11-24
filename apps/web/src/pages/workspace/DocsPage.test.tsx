// @vitest-environment jsdom

import { ORPCError } from "@orpc/client";
import type * as UiWeb from "@robots/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  notifications: { subscribe: vi.fn() },
  bots: { list: vi.fn() },
  docs: { list: vi.fn(), create: vi.fn(), revisions: vi.fn() },
  memory: { list: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("../../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));
vi.mock("./WorkspaceLayout", () => ({
  WorkspaceLayout: ({
    title,
    actions,
    children,
  }: {
    title: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    open,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    confirmLabel: ReactNode;
    onConfirm: () => void;
  }) =>
    open ? (
      <button type="button" data-testid="confirm" onClick={onConfirm}>
        {confirmLabel}
      </button>
    ) : null,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@robots/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children?: ReactNode }) => (
    <div data-testid="chat-markdown">{children}</div>
  ),
}));
vi.mock("@robots/ui-web", async (importOriginal) => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
    Disclosure: ({ summary, children }: { summary: ReactNode; children: ReactNode }) => (
      <div>
        {summary}
        {children}
      </div>
    ),
    DropdownMenu: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuContent: Container,
    DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
      <button type="button" role="menuitem" onClick={onClick}>
        {children}
      </button>
    ),
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    ListSearchInput: ({
      query,
      setQuery,
      label,
    }: {
      query: string;
      setQuery: (query: string) => void;
      label: string;
    }) => (
      <input aria-label={label} value={query} onChange={(event) => setQuery(event.target.value)} />
    ),
    SectionHeading: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  };
});

import { readComposerDraft } from "../../lib/composer-draft";
import { DocsPage } from "./DocsPage";

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function doc(id: string, path: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    scope: "user",
    botId: null,
    path,
    content: `# ${path}`,
    revision: 1,
    updatedAt: new Date().toISOString(),
    editedByBotId: null,
    ...fields,
  };
}

const neverEnding = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };

let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.notifications.subscribe.mockResolvedValue(neverEnding);
  api.bots.list.mockResolvedValue([{ id: "bot-1", name: "Helper" }]);
  api.docs.list.mockResolvedValue([
    doc("doc-1", "Roadmap.md", { editedByBotId: "bot-1" }),
    doc("doc-2", "Mission.md"),
    doc("doc-3", "MEMORY.md", { scope: "bot", botId: "bot-1" }),
  ]);
});

async function renderDocs() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/docs"]}>
          <Routes>
            <Route path="/app/docs" element={<DocsPage />} />
            <Route path="/app/:botId" element={<p data-testid="chat">chat</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
  const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  const type = async (element: HTMLElement | null, value: string) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (element: HTMLElement | null | undefined) => {
    await act(async () => element?.click());
    await settle();
  };
  return {
    container,
    $,
    button,
    type,
    click,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("lists shared docs with who edited them, filters by search, and keeps bot notes in background files", async () => {
  const page = await renderDocs();
  const library = page.$('[data-testid="docs-library"]');
  expect(page.$('[data-testid="doc-row-doc-1"]')?.textContent).toContain("Roadmap");
  expect(page.$('[data-testid="doc-row-doc-1"]')?.textContent).toContain("Helper");
  expect(library?.textContent).toContain("Background files");
  expect(page.$('[data-testid="doc-row-doc-3"]')?.closest("section")?.textContent).toContain(
    "Helper",
  );

  await page.type(page.container.querySelector('input[aria-label="Search docs"]'), "mission");
  expect(page.$('[data-testid="doc-row-doc-1"]')).toBeNull();
  expect(page.$('[data-testid="doc-row-doc-2"]')).not.toBeNull();
  await page.cleanup();
});

it("opens a doc as Markdown, saves an edit against the revision it read, and goes back", async () => {
  api.memory.update.mockResolvedValue(doc("doc-1", "Roadmap.md", { revision: 2 }));
  const page = await renderDocs();
  await page.click(page.$('[data-testid="doc-row-doc-1"]'));
  expect(page.$('[data-testid="chat-markdown"]')?.textContent).toBe("# Roadmap.md");
  expect(page.$('[data-testid="docs-library"]')?.className).toContain("hidden md:flex");

  await page.click(page.button("Edit"));
  await page.type(page.$('textarea[aria-label="Edit Roadmap"]'), "# Next");
  await page.click(page.button("Save"));
  expect(api.memory.update).toHaveBeenCalledWith({
    documentId: "doc-1",
    content: "# Next",
    expectedRevision: 1,
  });
  expect(page.$("textarea")).toBeNull();

  await page.click(page.container.querySelector('button[aria-label="Back to docs"]'));
  expect(page.$('[data-testid="doc-reader"]')).toBeNull();
  await page.cleanup();
});

it("keeps the draft and explains a conflict when the doc changed meanwhile", async () => {
  api.memory.update.mockRejectedValue(new ORPCError("CONFLICT"));
  const page = await renderDocs();
  await page.click(page.$('[data-testid="doc-row-doc-2"]'));
  await page.click(page.button("Edit"));
  await page.type(page.$("textarea"), "Mine");
  await page.click(page.button("Save"));
  expect(page.$('[role="alert"]')?.textContent).toContain("changed while you were editing");
  expect((page.$("textarea") as HTMLTextAreaElement).value).toBe("Mine");

  await page.click(page.button("Discard"));
  expect(page.$("textarea")).toBeNull();
  expect(page.$('[role="alert"]')).toBeNull();
  await page.cleanup();
});

it("creates a doc and opens it", async () => {
  api.docs.create.mockImplementation(async () => {
    api.docs.list.mockResolvedValue([doc("doc-9", "Plan.md")]);
    return doc("doc-9", "Plan.md");
  });
  const page = await renderDocs();
  await page.click(page.$('[data-testid="docs-new"]'));
  await page.type(page.container.querySelector('input[aria-label="Doc name"]'), "Plan");
  await page.type(page.container.querySelector('textarea[aria-label="Content"]'), "Steps");
  await page.click(page.button("Create"));
  expect(api.docs.create).toHaveBeenCalledWith({ name: "Plan", content: "Steps" });
  expect(page.$('[data-testid="doc-reader"]')?.textContent).toContain("Plan");
  await page.cleanup();
});

it("deletes a doc after confirming, but never the memory index", async () => {
  api.memory.remove.mockImplementation(async () => {
    api.docs.list.mockResolvedValue([]);
    return { ok: true };
  });
  const page = await renderDocs();
  await page.click(page.$('[data-testid="doc-row-doc-3"]'));
  expect(page.button("Delete")).toBeUndefined();

  await page.click(page.$('[data-testid="doc-row-doc-2"]'));
  await page.click(page.button("Delete"));
  await page.click(page.$('[data-testid="confirm"]'));
  expect(api.memory.remove).toHaveBeenCalledWith({ documentId: "doc-2" });
  expect(page.$('[data-testid="doc-reader"]')).toBeNull();
  await page.cleanup();
});

it("shows an earlier version from the history", async () => {
  api.docs.list.mockResolvedValue([doc("doc-1", "Roadmap.md", { revision: 2 })]);
  api.docs.revisions.mockResolvedValue([
    { revision: 2, content: "# Roadmap.md", createdAt: "", editedByBotId: null },
    { revision: 1, content: "Old plan", createdAt: "", editedByBotId: "bot-1" },
  ]);
  const page = await renderDocs();
  await page.click(page.$('[data-testid="doc-row-doc-1"]'));
  await page.click(page.button("History"));
  expect(api.docs.revisions).toHaveBeenCalledWith({ documentId: "doc-1" }, expect.anything());
  const older = [...(page.$('[data-testid="doc-history"]')?.querySelectorAll("button") ?? [])].at(
    1,
  );
  expect(older?.textContent).toContain("Helper");
  await page.click(older);
  expect(page.$('[data-testid="doc-revision"]')?.textContent).toContain("Old plan");
  await page.cleanup();
});

it("asks a bot to update the doc in its chat with the request drafted", async () => {
  const page = await renderDocs();
  await page.click(page.$('[data-testid="doc-row-doc-1"]'));
  await page.click(page.container.querySelector('[role="menuitem"]'));
  expect(page.$('[data-testid="chat"]')).not.toBeNull();
  expect(readComposerDraft("bot:bot-1")).toBe("Please update the doc Roadmap.md: ");
  await page.cleanup();
});

it("re-reads the library when the Space signals a memory change", async () => {
  let push: ((frame: { type: string }) => void) | undefined;
  api.notifications.subscribe.mockResolvedValue({
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          push = (value) => resolve({ value, done: false });
        }),
    }),
  });
  const page = await renderDocs();
  const reads = api.docs.list.mock.calls.length;
  await act(async () => push?.({ type: "memory" }));
  await settle();
  expect(api.docs.list.mock.calls.length).toBeGreaterThan(reads);
  await page.cleanup();
});
