// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Organization } from "../lib/organizations";

const { organizations, list } = vi.hoisted(() => ({
  organizations: { rename: vi.fn(), remove: vi.fn() },
  list: { current: [] as Organization[] },
}));

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@robots/ui-web", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Field: Box,
    FieldLabel: ({ children, htmlFor }: ComponentProps<"label">) => (
      <label htmlFor={htmlFor}>{children}</label>
    ),
    AlertDialog: Box,
    AlertDialogAction: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    AlertDialogCancel: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    AlertDialogContent: Box,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: Box,
    AlertDialogHeader: Box,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});
vi.mock("../lib/auth", () => ({ authClient: { $store: { notify: vi.fn() } } }));
vi.mock("../lib/rpc", () => ({
  rpc: { organizations },
  rpcForSpace: () => ({ organizations }),
  createSpaceRpc: () => ({ organizations }),
  selectedSpaceId: () => "s1",
  selectSpace: vi.fn(),
  clearSpaceSelection: vi.fn(),
}));
vi.mock("../lib/organizations", () => ({
  useOrganizations: () => ({ organizations: list.current, activeOrganizationId: "org-home" }),
  organizationsQuery: (userId: string | null) => ({
    queryKey: [`user:${userId ?? ""}`, "organizations"],
  }),
}));
vi.mock("../components/CreateOrganizationDialog", () => ({
  CreateOrganizationDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Create organization" /> : null,
}));

import { QueryUserProvider } from "../lib/query";
import { DeleteOrganizationDialog, OrganizationSettingsPanel } from "./OrganizationSettingsPanel";

const home: Organization = {
  id: "org-home",
  name: "Personal",
  defaultSpaceId: "s1",
  spaceIds: ["s1"],
  canManage: true,
  personal: true,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("enables Delete only once the organization's exact name is typed", async () => {
  const onConfirm = vi.fn(async () => undefined);
  await act(async () =>
    root.render(
      <DeleteOrganizationDialog
        organization={{
          id: "org-work",
          name: "Work",
          defaultSpaceId: "s2",
          spaceIds: ["s2"],
          canManage: true,
          personal: false,
        }}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    ),
  );
  const label = container.querySelector("label")!;
  expect(label.textContent).toBe("Type Work to confirm");
  const input = container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!;
  const remove = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Delete",
  )!;
  expect(remove.disabled).toBe(true);
  for (const wrong of ["work", "Wor", "Work "]) {
    await type(input, wrong);
    expect(remove.disabled).toBe(true);
  }
  await type(input, "Work");
  expect(remove.disabled).toBe(false);
  await act(async () => remove.click());
  expect(onConfirm).toHaveBeenCalledOnce();
});

async function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <QueryUserProvider value="user-a">
          <OrganizationSettingsPanel />
        </QueryUserProvider>
      </QueryClientProvider>,
    ),
  );
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find((each) => each.textContent === name);
}

function nameInput() {
  const label = [...container.querySelectorAll("label")].find(
    (each) => each.textContent === "Organization name",
  )!;
  return container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!;
}

it("leaves the current organization's name alone when a new name is typed and Create is chosen", async () => {
  list.current = [home];
  organizations.rename.mockReset();
  await renderPanel();
  const input = nameInput();
  await act(async () => input.focus());
  await type(input, "Northwind Payments Research");
  await act(async () => {
    input.blur();
    button("Create organization")!.click();
  });
  expect(organizations.rename).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

it("renames the current organization only through Save", async () => {
  list.current = [home];
  organizations.rename.mockReset().mockImplementation(async ({ name }: { name: string }) => ({
    id: home.id,
    name,
  }));
  await renderPanel();
  expect(button("Save")).toBeUndefined();
  await type(nameInput(), "  Home lab ");
  await act(async () => button("Save")!.click());
  expect(organizations.rename).toHaveBeenCalledExactlyOnceWith({
    organizationId: "org-home",
    name: "Home lab",
  });
});
