// @vitest-environment jsdom

import type { BotAvatarSet } from "@robots/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellDialogs, useShellDialogs } from "./shell-dialogs";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();

function Harness({ botAvatarSet }: { botAvatarSet: BotAvatarSet | undefined }) {
  const dialogs = useShellDialogs();
  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => dialogs.setCreateBotOpen(true)}>
        New bot
      </button>
      <ShellDialogs
        dialogs={dialogs}
        rpc={{} as never}
        spaces={[]}
        bots={[]}
        activeId={undefined}
        activeGroupId={undefined}
        alive={{ current: true }}
        navigate={() => undefined}
        setPanel={() => undefined}
        refreshBots={async () => undefined}
        removeSpace={async () => undefined}
        openSpaceSettings={() => undefined}
        closeMobileSidebar={() => undefined}
        createBot={async () => undefined}
        botAvatarSet={botAvatarSet}
        clearOpenThread={() => undefined}
        discardChatAttachments={() => undefined}
        deleteRoutineDialogProps={null}
        paletteActions={[]}
      />
    </QueryClientProvider>
  );
}

function render(botAvatarSet: BotAvatarSet | undefined) {
  return act(async () => root.render(<Harness botAvatarSet={botAvatarSet} />));
}

function newBotButton() {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "New bot",
  );
  if (!found) throw new Error("Missing New bot button");
  return found;
}

function newBotDialog() {
  return document.querySelector<HTMLElement>('[data-testid="create-bot-dialog"]');
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("New bot dialog avatar set", () => {
  it("does not open while the account's set is unknown", async () => {
    await render(undefined);
    await act(async () => newBotButton().click());
    expect(newBotDialog()).toBeNull();
  });

  it("opens the Original preview once an Original set arrives, not RoBots", async () => {
    await render(undefined);
    await act(async () => newBotButton().click());
    await render("organic");
    expect(newBotDialog()?.querySelector(".robots-organic-avatar")).not.toBeNull();
  });

  it("opens the RoBots preview for a RoBots account", async () => {
    await render("robots");
    await act(async () => newBotButton().click());
    expect(newBotDialog()).not.toBeNull();
    expect(newBotDialog()?.querySelector(".robots-organic-avatar")).toBeNull();
  });
});
