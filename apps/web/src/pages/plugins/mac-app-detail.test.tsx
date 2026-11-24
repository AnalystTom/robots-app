// @vitest-environment jsdom

import type { ActionRule, MacGrantId, MacGrantState } from "@robots/contracts";
import { MAC_APP_CONNECTIONS } from "@robots/contracts";
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
vi.mock("../../lib/user-devices", () => ({
  listUserDevices: async () => [{ deviceId: "mac-1", name: "Studio", connected: true }],
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

import { MacAppDetail } from "./mac-app-detail";

let rules: ActionRule[] = [];
let grants: MacGrantState[] = [];
const allow = vi.fn(async (grant: MacGrantId) => {
  grants = grants.map((entry) => (entry.grant === grant ? { grant, status: "granted" } : entry));
  return grants;
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rules = [];
  grants = [{ grant: "automation-mail", status: "not-determined" }];
  allow.mockClear();
  window.robotsDesktop = {
    platform: "darwin",
    macApps: { permissions: async () => grants, allow },
  } as never;
  rpcMock.actionRules.list.mockReset().mockImplementation(async () => rules);
  rpcMock.actionRules.set.mockReset().mockImplementation(async (input: { rules: ActionRule[] }) => {
    rules = input.rules;
    return rules;
  });
  rpcMock.approvalRules.list.mockReset().mockResolvedValue([]);
  rpcMock.autoReview.get.mockReset().mockResolvedValue({
    mode: "ask",
    enabled: false,
    checkerAvailable: false,
    skipApprovals: false,
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  window.robotsDesktop = undefined;
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render() {
  const mail = MAC_APP_CONNECTIONS.find((app) => app.id === "mail");
  if (!mail) throw new Error("Mail is missing");
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    createRoot(container).render(
      <QueryClientProvider client={client}>
        <MacAppDetail app={mail} botName="Robo" />
      </QueryClientProvider>,
    ),
  );
  await flush();
  return container;
}

function buttonIn(scope: ParentNode | null | undefined, text: string) {
  return [...(scope?.querySelectorAll("button") ?? [])].find((node) => node.textContent === text);
}

it("shows Mail on this Mac with its grants and tool defaults", async () => {
  const container = await render();
  expect(container.textContent).toContain("Works while it's online");
  expect(container.textContent).toContain("Online");
  const grant = container.querySelector('[data-testid="mac-grant"]');
  expect(grant?.textContent).toContain("Control Mail");
  expect(grant?.textContent).toContain("Not allowed yet");
  expect(
    container.querySelector('[aria-label="Permission for finding and reading"]')?.textContent,
  ).toBe("Asks once");
  expect(container.querySelector('[aria-label="Permission for Send an email"]')?.textContent).toBe(
    "Ask each time",
  );
  expect(container.textContent).toContain("Robo asks before each email");

  await act(async () => buttonIn(grant, "Allow")?.click());
  await flush();
  expect(allow).toHaveBeenCalledWith("automation-mail");
  expect(container.querySelector('[data-testid="mac-grant"]')?.textContent).toContain("Allowed");
});

it("opens the send permission dialog with the grants sending needs", async () => {
  grants = [{ grant: "automation-mail", status: "denied" }];
  const container = await render();
  await act(async () =>
    container.querySelector<HTMLElement>('[data-testid="tool-row-risky"] button')?.click(),
  );
  await flush();
  const dialog = document.body.querySelector('[data-testid="permission-dialog"]');
  expect(dialog?.textContent).toContain("Allow Robo to send email");
  expect(dialog?.textContent).toContain("Control Mail");
  expect(dialog?.textContent).toContain("Turned off in System Settings");
  expect(buttonIn(dialog, "Allow")).toBeDefined();
  await act(async () => dialog?.querySelector<HTMLElement>('[role="switch"]')?.click());
  await flush();
  expect(rules).toEqual([
    expect.objectContaining({ matchKind: "tool", matchValue: "mac_mail_send", effect: "deny" }),
  ]);
});

it("turns the whole app off with one connector rule", async () => {
  const container = await render();
  const toggle = container.querySelector<HTMLElement>('[aria-label="Let Robo use Mail"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle?.click());
  await flush();
  expect(rules).toEqual([
    expect.objectContaining({ matchKind: "connector", matchValue: "mac_mail", effect: "deny" }),
  ]);
  expect(container.querySelector('[aria-label="Permission for Send an email"]')?.textContent).toBe(
    "Off",
  );
});
