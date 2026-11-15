// @vitest-environment jsdom

import type * as UiWeb from "@robots/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  bots: { list: vi.fn(), claimEmailAddress: vi.fn() },
  email: { mailboxes: vi.fn(), messages: vi.fn(), message: vi.fn() },
}));
const drafts = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock("../../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("../../lib/composer-draft", () => ({
  appendComposerDraftText: drafts.append,
  composerDraftKey: ({ botId }: { botId: string }) => `bot:${botId}`,
}));
vi.mock("../../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));
vi.mock("../WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@robots/ui-web", async (importOriginal) => ({
  ...(await importOriginal<typeof UiWeb>()),
  BotAvatar: ({ identity }: { identity?: string }) => <span data-testid={`avatar-${identity}`} />,
}));

import { EmailPage } from "./EmailPage";

const DOMAIN = "mail.example.test";

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    botId: "bot-1",
    sent: false,
    fromName: "Ada",
    fromAddress: "ada@example.test",
    to: [`helper@${DOMAIN}`],
    subject: `Subject ${id}`,
    preview: "Hello there",
    verified: true,
    receivedAt: "2026-11-01T00:00:00.000Z",
    fileCount: 0,
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

let client: QueryClient;
let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Math, "random").mockReturnValue(0);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  drafts.append.mockReset();
  api.bots.list.mockResolvedValue([{ id: "bot-1", name: "Helper", color: "blue" }]);
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function render(entry = "/app/email") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/app/email" element={<EmailPage />} />
            <Route path="/app/:botId" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
  await settle();
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("Nothing to click");
  await act(async () => (element as HTMLElement).click());
  await settle();
  await settle();
}

const byText = (container: HTMLElement, selector: string, text: string) =>
  [...container.querySelectorAll(selector)].find((element) => element.textContent?.includes(text));

it("lists a bot's mailbox and reads a message as plain text", async () => {
  api.email.mailboxes.mockResolvedValue({
    domain: DOMAIN,
    mailboxes: [{ botId: "bot-1", botName: "Helper", address: `helper@${DOMAIN}` }],
  });
  api.email.messages.mockResolvedValue({
    messages: [summary("m-1"), summary("m-2", { verified: false, fromName: "" })],
    nextCursor: null,
  });
  api.email.message.mockResolvedValue({
    ...summary("m-2", { verified: false, fromName: "" }),
    cc: [],
    text: "<b>Click</b> <script>alert(1)</script>",
    files: [{ name: "invoice.pdf", kept: true }],
  });
  const container = await render();

  expect(container.querySelector('[data-testid="avatar-bot-1"]')).not.toBeNull();
  expect(container.textContent).toContain(`helper@${DOMAIN}`);
  expect(api.email.messages).toHaveBeenCalledWith(
    { botId: "bot-1", folder: "inbox" },
    expect.anything(),
  );
  expect(container.textContent).toContain("Subject m-1");
  expect(container.textContent).toContain("Hello there");

  await click(byText(container, "button", "Subject m-2"));
  expect(api.email.message).toHaveBeenCalledWith({ id: "m-2" }, expect.anything());
  const text = container.querySelector('[data-testid="email-text"]');
  expect(text?.textContent).toBe("<b>Click</b> <script>alert(1)</script>");
  expect(text?.querySelector("b, script")).toBeNull();
  expect(container.textContent).toContain("Unverified sender");
  expect(container.textContent).toContain("invoice.pdf");
});

it("shows what the bot sent under Sent", async () => {
  api.email.mailboxes.mockResolvedValue({
    domain: DOMAIN,
    mailboxes: [{ botId: "bot-1", botName: "Helper", address: `helper@${DOMAIN}` }],
  });
  api.email.messages.mockImplementation(async ({ folder }: { folder: string }) => ({
    messages:
      folder === "sent"
        ? [summary("s-1", { sent: true, to: ["bob@example.test"], subject: "Report" })]
        : [],
    nextCursor: null,
  }));
  const container = await render();
  expect(container.textContent).toContain("No mail yet.");

  await click(byText(container, '[role="tab"]', "Sent"));
  expect(api.email.messages).toHaveBeenCalledWith(
    { botId: "bot-1", folder: "sent" },
    expect.anything(),
  );
  expect(container.textContent).toContain("To bob@example.test");
  expect(container.textContent).toContain("Report");
});

it("asks the bot about a message in its chat with a drafted note", async () => {
  api.email.mailboxes.mockResolvedValue({
    domain: DOMAIN,
    mailboxes: [{ botId: "bot-1", botName: "Helper", address: `helper@${DOMAIN}` }],
  });
  api.email.messages.mockResolvedValue({ messages: [summary("m-1")], nextCursor: null });
  api.email.message.mockResolvedValue({ ...summary("m-1"), cc: [], text: "Hi", files: [] });
  const container = await render("/app/email?bot=bot-1&message=m-1");

  await click(byText(container, "button", "Ask Helper"));
  expect(drafts.append).toHaveBeenCalledWith(
    "bot:bot-1",
    'About the email "Subject m-1" (id m-1):',
  );
  expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/app/bot-1");
});

it("says plainly when the server receives no email", async () => {
  api.email.mailboxes.mockResolvedValue({ domain: null, mailboxes: [] });
  const container = await render();
  expect(container.textContent).toContain("This server doesn't receive email");
  expect(api.email.messages).not.toHaveBeenCalled();
});

it("offers an address to each bot until one has a mailbox", async () => {
  api.email.mailboxes.mockResolvedValue({
    domain: DOMAIN,
    mailboxes: [{ botId: "bot-1", botName: "Helper", address: null }],
  });
  const container = await render();
  expect(container.textContent).toContain("No mailboxes yet");
  expect(container.querySelector('input[aria-label="Email address"]')).not.toBeNull();
  expect(container.textContent).toContain(`@${DOMAIN}`);
  expect(api.email.messages).not.toHaveBeenCalled();
});
