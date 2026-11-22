// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { BOT_TEMPLATE_TEAMS, BOT_TEMPLATES } from "@robots/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryUserProvider } from "../../lib/query";

const server = vi.hoisted(() => ({
  bots: new Map<string, { id: string; name: string }>(),
  creations: [] as string[],
  failing: new Set<string>(),
  templateReads: 0,
}));

const rpcMock = vi.hoisted(() => {
  const createBot = (templateId: string) => {
    const template = BOT_TEMPLATES.find((item) => item.id === templateId)!;
    const bot = { id: `bot-${templateId}`, name: template.name };
    server.creations.push(templateId);
    server.bots.set(templateId, bot);
    return bot;
  };
  return {
    bots: {
      templates: async () => {
        server.templateReads += 1;
        return BOT_TEMPLATES.map((template) => ({
          ...template,
          botId: server.bots.get(template.id)?.id ?? null,
        }));
      },
      list: async () => [...server.bots.values()],
      get: async ({ botId }: { botId: string }) =>
        [...server.bots.values()].find((bot) => bot.id === botId),
      createFromTemplate: async ({ templateId }: { templateId: string }) => ({
        bot: server.bots.get(templateId) ?? createBot(templateId),
        created: !server.bots.has(templateId),
      }),
      createTeamFromTemplate: async ({ teamId }: { teamId: string }) => {
        const team = BOT_TEMPLATE_TEAMS.find((item) => item.id === teamId)!;
        const bots: { id: string; name: string }[] = [];
        const failed: string[] = [];
        for (const templateId of team.templateIds) {
          const existing = server.bots.get(templateId);
          if (existing) bots.push(existing);
          else if (server.failing.has(templateId)) failed.push(templateId);
          else bots.push(createBot(templateId));
        }
        return { bots, failed };
      },
    },
    connections: { catalog: async () => [] },
  };
});

vi.mock("../../lib/rpc", () => ({
  rpc: rpcMock,
  rpcForSpace: () => rpcMock,
  createSpaceRpc: () => rpcMock,
  selectedSpaceId: () => null,
}));

i18n.load("en", {});
i18n.activate("en");

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => text + part + (index < values.length ? values[index] : ""),
      "",
    );
  return {
    useLingui: () => ({ t, i18n }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

vi.mock("@robots/ui-web", () => {
  const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    BotAvatar: () => null,
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
    Dialog: Plain,
    DialogClose: ({ render }: { render: ReactNode }) => <>{render}</>,
    DialogContent: Plain,
    DialogHeader: Plain,
    DialogTitle: Plain,
    Spinner: () => null,
  };
});

import { BotTemplatesDialog } from "./bot-templates-dialog";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  server.bots.clear();
  server.creations.length = 0;
  server.failing.clear();
  server.templateReads = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function until<T>(read: () => T | null | undefined | false): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = read();
    if (value) return value;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error("Condition never held");
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}

async function press(label: string) {
  const target = await until(() => button(label));
  await act(async () => target.click());
}

it("keeps the bots a team made when one member fails, and retries only the missing one", async () => {
  const team = BOT_TEMPLATE_TEAMS[0];
  const [lead] = team.templateIds.map((id) => BOT_TEMPLATES.find((item) => item.id === id)!);
  const failingMember = team.templateIds[3]!;
  server.failing.add(failingMember);
  const onOpenBot = vi.fn();

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <QueryUserProvider value="user-1">
          <BotTemplatesDialog onClose={() => undefined} onOpenBot={onOpenBot} />
        </QueryUserProvider>
      </QueryClientProvider>,
    );
  });
  await press("Create team");

  await until(() =>
    container.textContent?.includes("Created 5 of 6 bots. Try again to finish the team."),
  );
  await until(() => button("Open"));
  expect(server.bots.size).toBe(team.templateIds.length - 1);

  const readsBeforeRetry = server.templateReads;
  server.failing.clear();
  await press("Retry");

  const opened = await until(() => onOpenBot.mock.calls[0]?.[0]);
  expect(opened.name).toBe(lead!.name);
  expect(server.templateReads).toBeGreaterThan(readsBeforeRetry);
  expect([...server.creations].sort()).toEqual([...team.templateIds].sort());
});
