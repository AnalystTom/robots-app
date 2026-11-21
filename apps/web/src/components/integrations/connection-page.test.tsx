// @vitest-environment jsdom

import type { ActionRule } from "@robots/contracts";
import type { PermissionTool } from "@robots/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  actionRules: { list: vi.fn(), set: vi.fn() },
  approvalRules: { list: vi.fn() },
  autoReview: { get: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({
  rpc: rpcMock,
  rpcForSpace: () => rpcMock,
  createSpaceRpc: () => rpcMock,
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => text + part + (index < values.length ? values[index] : ""),
      "",
    );
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: ({ value }: { value: number }) => `${value} tools`,
  };
});

import { ToolsSection } from "./connection-page";
import type { PermissionGrant } from "./permission-dialog";

const send: PermissionTool = { name: "GMAIL_SEND_EMAIL", label: "Send email" };
const list: PermissionTool = {
  name: "GMAIL_LIST_MESSAGES",
  label: "List messages",
  readOnly: true,
};
const label: PermissionTool = { name: "GMAIL_ADD_LABEL", label: "Add label" };

let rules: ActionRule[] = [];
let mode: "never" | "auto" | "ask" = "ask";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rules = [];
  mode = "ask";
  rpcMock.actionRules.list.mockReset().mockImplementation(async () => rules);
  rpcMock.actionRules.set.mockReset().mockImplementation(async (input: { rules: ActionRule[] }) => {
    rules = input.rules;
    return rules;
  });
  rpcMock.approvalRules.list.mockReset().mockResolvedValue([]);
  rpcMock.autoReview.get.mockReset().mockImplementation(async () => ({
    mode,
    enabled: mode === "auto",
    checkerAvailable: false,
    skipApprovals: mode === "never",
  }));
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(grants: PermissionGrant[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ToolsSection
          appName="Gmail"
          appSlug="gmail"
          tools={[send, list, label]}
          loading={false}
          botName="Robo"
          grantsFor={() => grants}
        />
      </QueryClientProvider>,
    );
  });
  await flush();
  return container;
}

function permissionOf(container: HTMLElement, tool: string) {
  return container.querySelector(`[aria-label="Permission for ${tool}"]`)?.textContent;
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[data-testid="permission-dialog"]');
}

it("shows each tool's state from the approval rules and the mode", async () => {
  const container = await render();
  expect(container.querySelector('[data-testid="tool-row-lookups"]')?.textContent).toContain(
    "Find and read",
  );
  expect(permissionOf(container, "finding and reading")).toBe("Allowed");
  expect(permissionOf(container, "Send email")).toBe("Ask each time");
  expect(permissionOf(container, "Add label")).toBe("Ask each time");
  expect(container.textContent).toContain("Robo asks before each email");
});

it("opens the permission dialog from a risky tool and turns it off through an action rule", async () => {
  const container = await render();
  const risky = container.querySelector<HTMLElement>('[data-testid="tool-row-risky"] button');
  expect(risky?.textContent).toContain("Send email");
  expect(
    container.querySelector('[data-testid="tool-row"] button')?.getAttribute("aria-label"),
  ).toBe("Permission for Add label");
  await act(async () => risky?.click());
  await flush();

  expect(dialog()?.textContent).toContain("Allow Robo to send email");
  expect(dialog()?.textContent).toContain("Robo writes each email and sends it only after you");
  const toggle = dialog()?.querySelector<HTMLElement>('[role="switch"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle?.click());
  await flush();

  expect(rpcMock.actionRules.set).toHaveBeenCalledTimes(1);
  expect(rpcMock.actionRules.set.mock.calls[0]?.[0]).toMatchObject({
    rules: [{ matchKind: "tool", matchValue: "GMAIL_SEND_EMAIL", initiator: null, effect: "deny" }],
  });
  expect(dialog()?.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(permissionOf(container, "Send email")).toBe("Off");
  expect(container.textContent).not.toContain("Robo asks before each email");
});

it("turning a capability back on asks first and removes the rule the mode already covers", async () => {
  rules = [
    { id: "x", matchKind: "tool", matchValue: "GMAIL_SEND_EMAIL", initiator: null, effect: "deny" },
  ];
  const container = await render();
  await act(async () =>
    container.querySelector<HTMLElement>('[data-testid="tool-row-risky"] button')?.click(),
  );
  await flush();
  const toggle = dialog()?.querySelector<HTMLElement>('[role="switch"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle?.click());
  await flush();
  expect(rpcMock.actionRules.set.mock.calls[0]?.[0]).toEqual({ rules: [] });
  expect(permissionOf(container, "Send email")).toBe("Ask each time");
});

it("keeps asking when the mode never asks by writing an ask rule", async () => {
  mode = "never";
  rules = [
    { id: "x", matchKind: "tool", matchValue: "GMAIL_SEND_EMAIL", initiator: null, effect: "deny" },
  ];
  const container = await render();
  await act(async () =>
    container.querySelector<HTMLElement>('[data-testid="tool-row-risky"] button')?.click(),
  );
  await flush();
  await act(async () => dialog()?.querySelector<HTMLElement>('[role="switch"]')?.click());
  await flush();
  expect(rpcMock.actionRules.set.mock.calls[0]?.[0]).toMatchObject({
    rules: [{ matchValue: "GMAIL_SEND_EMAIL", effect: "ask" }],
  });
  expect(dialog()?.textContent).toContain("Robo asks before each email");
});

it("lists extra grants with an Allow button", async () => {
  const onAllow = vi.fn();
  const container = await render([
    { id: "scope", label: "Gmail send access", detail: "Lets Robo send", pending: false, onAllow },
  ]);
  await act(async () =>
    container.querySelector<HTMLElement>('[data-testid="tool-row-risky"] button')?.click(),
  );
  await flush();
  expect(dialog()?.textContent).toContain("Gmail send access");
  const allow = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Allow",
  );
  await act(async () => allow?.click());
  expect(onAllow).toHaveBeenCalledTimes(1);
});
