// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  const pending = () => new Promise(() => {});
  return {
    routines: { list: vi.fn(pending) },
    bots: { emailAddress: vi.fn(async () => null) },
    models: { credentials: vi.fn(pending), list: vi.fn(pending) },
  };
});
vi.mock("../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray) => parts.join(""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import type { RoutineDraftState } from "../lib/routine-draft";
import { emptyRoutineDraftState } from "../lib/routine-draft";
import { RoutineEditor } from "./RoutineEditor";

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function NewRoutine() {
  const [draft, setDraft] = useState<RoutineDraftState>({
    ...emptyRoutineDraftState(),
    name: "Inbox",
    prompt: "Summarize my inbox.",
  });
  return (
    <RoutineEditor
      bot={{ id: "bot-1", name: "Chief" }}
      draft={draft}
      onChange={setDraft}
      editing={null}
      timezone="UTC"
      webhook={{ path: "", secret: null, configured: false }}
      githubPath=""
      messageProviders={[]}
      saving={false}
      running={false}
      error={null}
      onBack={() => {}}
      onClose={() => {}}
      onSave={() => {}}
      onTestRun={() => {}}
      onDelete={() => {}}
      onEnsureWebhook={async () => {}}
      onRevealWebhook={async () => {}}
      onHideWebhook={() => {}}
    />
  );
}

function renderNewRoutine() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root = createRoot(container as HTMLElement);
    root.render(
      <QueryClientProvider client={client}>
        <NewRoutine />
      </QueryClientProvider>,
    );
  });
  return container;
}

function button(view: HTMLElement, name: string) {
  const match = [...view.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name || element.ariaLabel === name,
  );
  if (!match) throw new Error(`No ${name} button`);
  return match;
}

it("saves a new routine from a name and an instruction on the default schedule", () => {
  const view = renderNewRoutine();
  expect(button(view, "Save").disabled).toBe(false);
  expect(view.textContent).not.toContain("Add a trigger to save");
});

it("says why Save is disabled once the last trigger is removed", () => {
  const view = renderNewRoutine();
  act(() => button(view, "Remove schedule").click());
  const save = button(view, "Save");
  expect(save.disabled).toBe(true);
  const reason = document.getElementById(save.getAttribute("aria-describedby") ?? "");
  expect(reason?.textContent).toBe("Add a trigger to save");
});

it("says why Run now is disabled on a routine that is not saved yet", () => {
  const view = renderNewRoutine();
  const run = button(view, "Run now");
  expect(run.disabled).toBe(true);
  const reason = document.getElementById(run.getAttribute("aria-describedby") ?? "");
  expect(reason?.textContent).toBe("Save to run");
});
