// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({ actionRules: { list: vi.fn(), set: vi.fn() } }));
vi.mock("../lib/rpc", () => ({
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
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@robots/ui-web", async () => {
  const { createContext, useContext } = await import("react");
  const Toggle = createContext<{ value: string[]; onValueChange: (value: string[]) => void }>({
    value: [],
    onValueChange: () => undefined,
  });
  const Choice = createContext<{
    value: string;
    onValueChange: (value: string) => void;
    items: Array<{ value: string; label: string }>;
    label?: string;
  }>({ value: "", onValueChange: () => undefined, items: [] });
  const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    ToggleGroup: ({
      value,
      onValueChange,
      children,
      spacing: _spacing,
      ...props
    }: Omit<ComponentProps<"div">, "onChange"> & {
      value: string[];
      onValueChange: (value: string[]) => void;
      spacing?: number;
      disabled?: boolean;
    }) => (
      <Toggle.Provider value={{ value, onValueChange }}>
        <div {...props}>{children}</div>
      </Toggle.Provider>
    ),
    ToggleGroupItem: ({ value, children }: { value: string; children?: ReactNode }) => {
      const group = useContext(Toggle);
      return (
        <button
          type="button"
          aria-pressed={group.value.includes(value)}
          onClick={() => group.onValueChange([value])}
        >
          {children}
        </button>
      );
    },
    Select: ({
      value,
      onValueChange,
      items,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      items: Array<{ value: string; label: string }>;
      children?: ReactNode;
    }) => <Choice.Provider value={{ value, onValueChange, items }}>{children}</Choice.Provider>,
    SelectTrigger: (props: { "aria-label"?: string; disabled?: boolean }) => {
      const choice = useContext(Choice);
      return (
        <select
          aria-label={props["aria-label"]}
          disabled={props.disabled}
          value={choice.value}
          onChange={(event) => choice.onValueChange(event.target.value)}
        >
          {choice.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      );
    },
    SelectValue: () => null,
    SelectContent: () => null,
    SelectGroup: Plain,
    SelectItem: Plain,
  };
});

import { ActionRulesSettings } from "./ActionRulesSettings";

const stored = [
  { id: "r1", matchKind: "tool", matchValue: "send_email", effect: "allow", initiator: null },
  { id: "r2", matchKind: "connector", matchValue: "gmail", effect: "deny", initiator: "webhook" },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpcMock.actionRules.list.mockResolvedValue(stored);
  rpcMock.actionRules.set.mockImplementation(async ({ rules }) => rules);
});
afterEach(() => vi.unstubAllGlobals());

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ActionRulesSettings scope="account" />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(rows(container)).toHaveLength(2));
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="action-rule"]')].map((row) => row.textContent);
const control = <T extends HTMLElement>(container: HTMLElement, label: string) =>
  [...container.querySelectorAll<T>("button, input, select")].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  ) as T;
const within = (container: HTMLElement, groupLabel: string, name: string) =>
  [
    ...(container
      .querySelector(`[aria-label="${groupLabel}"]`)
      ?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((button) => button.textContent === name) as HTMLButtonElement;

function type(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
}

it("lists the rules in order, with who they apply to", async () => {
  const { container, cleanup } = await render();
  expect(rows(container)).toEqual(["1. Send emailAnyone", "2. Any gmail actionA webhook"]);
  expect(within(container, "Effect of rule 2", "Deny").getAttribute("aria-pressed")).toBe("true");
  await cleanup();
});

it("reorders, changes an effect and deletes, saving the whole ordered list", async () => {
  const { container, cleanup } = await render();
  await act(async () => control(container, "Move rule 2 up").click());
  expect(rpcMock.actionRules.set).toHaveBeenLastCalledWith({
    scope: "account",
    rules: [stored[1], stored[0]],
  });
  await vi.waitFor(() => expect(rows(container)[0]).toContain("Any gmail action"));

  await act(async () => within(container, "Effect of rule 2", "Ask").click());
  expect(rpcMock.actionRules.set).toHaveBeenLastCalledWith({
    scope: "account",
    rules: [stored[1], { ...stored[0], effect: "ask" }],
  });

  await vi.waitFor(() =>
    expect(control<HTMLButtonElement>(container, "Delete rule 1").disabled).toBe(false),
  );
  await act(async () => control(container, "Delete rule 1").click());
  expect(rpcMock.actionRules.set).toHaveBeenLastCalledWith({
    scope: "account",
    rules: [{ ...stored[0], effect: "ask" }],
  });
  await cleanup();
});

it("adds a rule for one initiator at the end of the list", async () => {
  const { container, cleanup } = await render();
  const add = control<HTMLButtonElement>(container, "Add");
  expect(add.disabled).toBe(true);
  await act(async () => type(control(container, "Action name"), "run_*"));
  await act(async () => type(control(container, "Started by"), "routine"));
  await act(async () => within(container, "Effect", "Deny").click());
  await act(async () => add.click());
  expect(rpcMock.actionRules.set).toHaveBeenLastCalledWith({
    scope: "account",
    rules: [
      ...stored,
      {
        id: expect.any(String),
        matchKind: "tool",
        matchValue: "run_*",
        effect: "deny",
        initiator: "routine",
      },
    ],
  });
  await cleanup();
});

it("shows which rule a dry run would match, without saving anything", async () => {
  const { container, cleanup } = await render();
  const verdict = () => container.querySelector('[data-testid="action-rule-verdict"]')?.textContent;
  const action = () =>
    [...container.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.getAttribute("aria-label") === "Action to test",
    ) as HTMLInputElement;
  const startedBy = () =>
    container.querySelectorAll<HTMLSelectElement>('[data-testid="action-rule-test"] select')[0]!;

  await act(async () => type(action(), "GMAIL_SEND_EMAIL"));
  expect(verdict()).toBe("No rule matches. The approval mode decides.");
  await act(async () => type(startedBy(), "webhook"));
  expect(verdict()).toBe("Rule 2 matches: Deny.");
  await act(async () => type(action(), "send_email"));
  expect(verdict()).toBe("Rule 1 matches: Allow.");
  expect(rpcMock.actionRules.set).not.toHaveBeenCalled();
  await cleanup();
});
