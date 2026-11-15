// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const pairing = vi.hoisted(() => ({ exchange: vi.fn(), take: vi.fn() }));
vi.mock("../lib/device-pairing", () => ({
  exchangePairingCode: pairing.exchange,
  takePairingCode: pairing.take,
}));
vi.mock("../lib/rpc", () => ({
  rpc: {},
  rpcForSpace: () => ({}),
  createSpaceRpc: () => ({}),
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => text + part + (index < values.length ? values[index] : ""),
      "",
    );
  return {
    useLingui: () => ({ t, i18n: { locale: "en-US" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@robots/ui-web", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Label: ({ children, htmlFor }: ComponentProps<"label">) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock("./Auth", () => ({
  submitClass: "",
  AuthFrame: ({
    title,
    onSubmit,
    children,
  }: {
    title: ReactNode;
    onSubmit: (event: React.FormEvent) => void;
    children: ReactNode;
  }) => (
    <form onSubmit={onSubmit}>
      <h1>{title}</h1>
      {children}
    </form>
  ),
}));

import { PairPage } from "./PairPage";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

async function render(onPaired = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={new QueryClient()}>
        <PairPage onPaired={onPaired} />
      </QueryClientProvider>,
    );
  });
  return container;
}

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("spends a code from the link at once and enters the app", async () => {
  pairing.take.mockReturnValue("ABCDEFGHJKMN");
  pairing.exchange.mockResolvedValue(undefined);
  const onPaired = vi.fn();
  const container = await render(onPaired);
  expect(pairing.exchange).toHaveBeenCalledTimes(1);
  expect(pairing.exchange).toHaveBeenCalledWith("ABCDEFGHJKMN");
  await vi.waitFor(() => expect(onPaired).toHaveBeenCalled());
  expect(container.querySelector("input")?.value).toBe("ABCD-EFGH-JKMN");
});

it("takes a typed code, and shows why one is refused", async () => {
  pairing.take.mockReturnValue(null);
  pairing.exchange.mockRejectedValue(new Error("This code is not valid. Create a new one."));
  const container = await render();
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.disabled).toBe(true);
  await act(async () => type(container.querySelector("input")!, "abcd efgh jkmn"));
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(pairing.exchange).toHaveBeenCalledWith("ABCDEFGHJKMN");
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This code is not valid. Create a new one.",
    ),
  );
});
