import { useLingui } from "@lingui/react/macro";
import type { Bot, CreateBotInput } from "@robots/contracts";
import { PRIMARY_BOT_SPAWN_KEY } from "@robots/contracts";
import { robotPresetValue } from "@robots/core";
import { BotAvatar } from "@robots/ui-web";
import { Plus, Star } from "lucide-react";

export { PRIMARY_BOT_SPAWN_KEY };

export function isPrimaryBot(bot: Pick<Bot, "spawnKey">): boolean {
  return bot.spawnKey === PRIMARY_BOT_SPAWN_KEY;
}

export const PRIMARY_BOT_INSTRUCTIONS = `You are RoBot: the user's primary bot and the orchestrator for every other Bot in this workspace.

- Everything comes to you first. Answer directly when it's quick; otherwise route it. Find the right Bot with list_fleet and hand it over with handoff_to_bot or message_bot, and tell the user who has it and why. If no Bot fits, offer to create one with spawn_bot.
- Know what each Bot is doing. When asked what's going on, check their recent work instead of guessing, and say what is finished, in progress, blocked or empty.
- If the Tasks board is available, track multi-step or delegated work there (ticket_create, ticket_update) so the user can see who is doing what.
- When a Bot reports back, summarise the result in a few lines and suggest one concrete next step.
- While you work, post a short line saying what you are checking next. Keep replies short and concrete, with real names and numbers.
- Ask before anything that sends email, publishes, spends money or can't be undone.`;

export function primaryBotCreateInput(name: string): CreateBotInput {
  return {
    name,
    description: "",
    instructions: PRIMARY_BOT_INSTRUCTIONS,
    notifyOnFinish: true,
    fleetManagement: true,
    spawnKey: PRIMARY_BOT_SPAWN_KEY,
    color: robotPresetValue("assistant"),
  };
}

export function PrimaryBotRow({
  bot,
  current,
  mini,
  creating,
  shortcut,
  onOpen,
  onSetUp,
}: {
  bot: Bot | undefined;
  current: boolean;
  mini: boolean;
  creating: boolean;
  shortcut?: string;
  onOpen: (bot: Bot) => void;
  onSetUp: () => void;
}) {
  const { t } = useLingui();
  if (mini) {
    const label = bot ? bot.name : t`Set up RoBot`;
    return (
      <button
        type="button"
        data-testid={bot ? "primary-bot" : "primary-bot-setup"}
        aria-current={bot && current ? "page" : undefined}
        aria-label={label}
        title={label}
        disabled={!bot && creating}
        onClick={() => (bot ? onOpen(bot) : onSetUp())}
        className={`relative mx-auto grid size-14 place-items-center rounded-2xl bg-sidebar-accent outline-none ring-sidebar-foreground/40 transition hover:brightness-125 focus-visible:ring-2 ${
          current ? "ring-2" : ""
        }`}
      >
        {bot ? (
          <BotAvatar color={bot.color} identity={bot.id} size={40} status={bot.status} />
        ) : (
          <Plus className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        {bot ? (
          <span
            aria-hidden="true"
            className="absolute -end-1 -bottom-1 grid size-5 place-items-center rounded-full bg-amber-500 text-white ring-2 ring-sidebar"
          >
            <Star className="size-2.5 fill-current" strokeWidth={0} />
          </span>
        ) : null}
        {bot?.unread ? (
          <span
            aria-hidden="true"
            className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-unread ring-2 ring-sidebar"
          />
        ) : null}
        {shortcut ? <ShortcutHint label={shortcut} className="-end-1 -top-2" /> : null}
      </button>
    );
  }
  const base =
    "flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-start text-body text-sidebar-foreground hover:bg-sidebar-accent";
  if (!bot) {
    return (
      <button
        type="button"
        data-testid="primary-bot-setup"
        disabled={creating}
        onClick={onSetUp}
        className={`${base} text-muted-foreground disabled:opacity-60`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-border">
          <Plus className="size-3.5" aria-hidden="true" />
        </span>
        <span className="truncate">{creating ? t`Setting up…` : t`Set up RoBot`}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="primary-bot"
      aria-current={current ? "page" : undefined}
      onClick={() => onOpen(bot)}
      className={`${base} ${current ? "bg-sidebar-accent" : ""}`}
    >
      <BotAvatar color={bot.color} identity={bot.id} size={28} status={bot.status} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{bot.name}</span>
        <span className="truncate text-caption text-muted-foreground">{t`Main point of contact`}</span>
      </span>
      {bot.unread ? (
        <span aria-hidden="true" className="ms-auto size-2 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

export function ShortcutHint({
  label,
  className = "-end-2 -top-2",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-shortcut-hint
      className={`pointer-events-none absolute z-10 hidden ${className} h-6 items-center rounded-md border border-white/10 bg-neutral-900 px-1.5 font-mono text-caption text-neutral-200 shadow-md in-data-[modifier-held=true]:flex`}
    >
      {label}
    </span>
  );
}
