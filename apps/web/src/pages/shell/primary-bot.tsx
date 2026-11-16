import { useLingui } from "@lingui/react/macro";
import type { Bot, CreateBotInput } from "@robots/contracts";
import { robotCharacterValue } from "@robots/contracts";
import { BotAvatar } from "@robots/ui-web";
import { Plus } from "lucide-react";

/** The Space's Primary Bot is the one created with this spawn key, so a rename keeps it primary. */
export const PRIMARY_BOT_SPAWN_KEY = "primary";

export function isPrimaryBot(bot: Pick<Bot, "spawnKey">): boolean {
  return bot.spawnKey === PRIMARY_BOT_SPAWN_KEY;
}

export const PRIMARY_BOT_INSTRUCTIONS = `You are the Primary Bot: the user's main point of contact in this workspace.

- Answer questions and take requests directly when you can.
- For specialist work, pick the right Bot with list_fleet and hand it over with message_bot or handoff_to_bot. If no Bot fits, suggest creating one.
- Track multi-step or delegated work on the Tasks board (ticket_create, ticket_update) so the user can see who is doing what.
- When a specialist reports back, summarise the result for the user and link the task.
- Keep replies short. Ask before anything that sends email, spends money or can't be undone.`;

/** Creating twice returns the same Bot: the server treats the spawn key as idempotent. */
export function primaryBotCreateInput(name: string): CreateBotInput {
  return {
    name,
    description: "",
    instructions: PRIMARY_BOT_INSTRUCTIONS,
    notifyOnFinish: true,
    fleetManagement: true,
    spawnKey: PRIMARY_BOT_SPAWN_KEY,
    color: robotCharacterValue({
      colour: "teal",
      headwear: "antenna",
      face: "happy",
      outfit: "tuxedo",
      extra: "none",
    }),
  };
}

/** The Primary Bot pinned at the top of the sidebar, or a button to set one up. */
export function PrimaryBotRow({
  bot,
  current,
  mini,
  creating,
  onOpen,
  onSetUp,
}: {
  bot: Bot | undefined;
  current: boolean;
  mini: boolean;
  creating: boolean;
  onOpen: (bot: Bot) => void;
  onSetUp: () => void;
}) {
  const { t } = useLingui();
  const base = `flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-start text-body text-sidebar-foreground hover:bg-sidebar-accent ${
    mini ? "justify-center px-0" : ""
  }`;
  if (!bot) {
    const label = t`Set up Primary Bot`;
    return (
      <button
        type="button"
        data-testid="primary-bot-setup"
        disabled={creating}
        aria-label={mini ? label : undefined}
        title={mini ? label : undefined}
        onClick={onSetUp}
        className={`${base} text-muted-foreground disabled:opacity-60`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-border">
          <Plus className="size-3.5" aria-hidden="true" />
        </span>
        {mini ? null : <span className="truncate">{creating ? t`Setting up…` : label}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="primary-bot"
      aria-current={current ? "page" : undefined}
      aria-label={mini ? bot.name : undefined}
      title={mini ? bot.name : undefined}
      onClick={() => onOpen(bot)}
      className={`${base} ${current ? "bg-sidebar-accent" : ""}`}
    >
      <BotAvatar color={bot.color} identity={bot.id} size={28} status={bot.status} />
      {mini ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium">{bot.name}</span>
          <span className="truncate text-caption text-muted-foreground">{t`Main point of contact`}</span>
        </span>
      )}
      {bot.unread && !mini ? (
        <span aria-hidden="true" className="ms-auto size-2 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}
