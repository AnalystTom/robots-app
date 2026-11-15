// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  devicePairing: { create: vi.fn(), devices: vi.fn(), revoke: vi.fn(), revokeOthers: vi.fn() },
}));
vi.mock("../lib/rpc", () => ({
  rpc: rpcMock,
  rpcForSpace: () => rpcMock,
  createSpaceRpc: () => rpcMock,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "2h ago" }));
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
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  useCopyText: () => [false, vi.fn(async () => true), false, vi.fn(), ""],
}));
vi.mock("./ConfirmDialog", () => ({
  ConfirmDialog: ({
    title,
    onConfirm,
    confirmLabel,
  }: {
    title: ReactNode;
    onConfirm: () => void;
    confirmLabel: ReactNode;
  }) => (
    <div role="dialog">
      {title}
      <button type="button" onClick={onConfirm}>
        Confirm {confirmLabel}
      </button>
    </div>
  ),
}));

import { DevicePairingSettings } from "./DevicePairingSettings";

const device = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  name: "",
  userAgent: "Mozilla/5.0 (iPhone)",
  ipAddress: "192.168.1.20",
  pairedAt: "2026-11-01T10:00:00.000Z",
  lastSeenAt: "2026-11-02T10:00:00.000Z",
  current: false,
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpcMock.devicePairing.devices.mockResolvedValue([]);
});

async function render(sharedUrls: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DevicePairingSettings sharedUrls={sharedUrls} />
      </QueryClientProvider>,
    );
  });
  return container;
}

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === name,
  )!;

it("shows a new code with its link and QR code for the shared address", async () => {
  rpcMock.devicePairing.create.mockResolvedValue({
    code: "ABCDEFGHJKMN",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  const container = await render(["http://192.168.1.5:45173"]);
  await act(async () => button(container, "Create code").click());
  expect(rpcMock.devicePairing.create).toHaveBeenCalled();
  expect(container.querySelector('[data-testid="pairing-code"]')?.textContent).toBe(
    "ABCD-EFGH-JKMN",
  );
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Pairing link"]')?.value).toBe(
    "http://192.168.1.5:45173/pair#token=ABCDEFGHJKMN",
  );
  expect(container.querySelector('svg[aria-label="Pairing QR code"]')).not.toBeNull();
  expect(container.textContent).toMatch(/Expires in [45]:\d\d/);
});

it("shows only the code when this page is reachable from this computer alone", async () => {
  rpcMock.devicePairing.create.mockResolvedValue({
    code: "ABCDEFGHJKMN",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  const container = await render();
  await act(async () => button(container, "Create code").click());
  expect(container.querySelector('input[aria-label="Pairing link"]')).toBeNull();
  expect(container.textContent).toContain("Pair with a code");
});

it("lists paired devices and signs one out", async () => {
  rpcMock.devicePairing.devices.mockResolvedValue([
    device("current", { current: true, name: "Laptop" }),
    device("phone"),
  ]);
  rpcMock.devicePairing.revoke.mockResolvedValue({ ok: true });
  const container = await render();
  await vi.waitFor(() => expect(container.textContent).toContain("iPhone"));
  expect(container.textContent).toContain("LaptopThis device");
  expect(container.querySelector('button[aria-label="Sign out Laptop"]')).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Sign out iPhone"]')!.click(),
  );
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Sign out "iPhone"?');
  await act(async () => button(container, "Confirm Sign out").click());
  expect(rpcMock.devicePairing.revoke).toHaveBeenCalledWith({ id: "phone" });
});

it("signs out every other device at once", async () => {
  rpcMock.devicePairing.devices.mockResolvedValue([
    device("current", { current: true }),
    device("phone"),
    device("tablet", { name: "Tablet" }),
  ]);
  rpcMock.devicePairing.revokeOthers.mockResolvedValue({ revoked: 2 });
  const container = await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Tablet"));
  await act(async () => button(container, "Sign out all").click());
  await act(async () => button(container, "Confirm Sign out").click());
  expect(rpcMock.devicePairing.revokeOthers).toHaveBeenCalled();
});
