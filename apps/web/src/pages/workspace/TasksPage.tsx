import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, Ticket, TicketStatus } from "@robots/contracts";
import { BotAvatar, Button, SectionHeading } from "@robots/ui-web";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSave } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { errorText } from "../../lib/user-error";
import { TicketDialog } from "../board/TicketDialog";
import { useBoard } from "../board/use-board";
import type { TaskColumnId } from "./task-columns";
import { moveTarget, TASK_COLUMNS, taskColumns } from "./task-columns";
import { WorkspaceLayout } from "./WorkspaceLayout";

/** Cards a column shows before "Show all". */
const COLUMN_PREVIEW = 4;
const DRAG_TYPE = "text/plain";

/** The ticket board in four columns; drag a card to move it, or change its status in the ticket. */
export function TasksPage() {
  const { t } = useLingui();
  const { tickets, bots, error, reload, ticketsKey } = useBoard();
  // `?ticket=` opens that ticket, as Today's links do.
  const [params, setParams] = useSearchParams();
  const openId = params.get("ticket");
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<TaskColumnId>>(new Set());
  const [over, setOver] = useState<TaskColumnId | null>(null);
  const move = useSave({
    save: (input: { id: string; status: TicketStatus }, rpc) => rpc.tickets.move(input),
    stale: [ticketsKey],
  });
  // A card shows in the column it was dropped on while the move is saving.
  const shown = useMemo(
    () =>
      move.pending && move.input
        ? tickets.map((ticket) =>
            ticket.id === move.input?.id ? { ...ticket, status: move.input.status } : ticket,
          )
        : tickets,
    [tickets, move.pending, move.input],
  );
  const columns = taskColumns(shown, showClosed);
  const hasClosed = tickets.some((ticket) => ticket.status === "closed");
  const titles: Record<TaskColumnId, string> = {
    notStarted: t`Not started`,
    needsYou: t`Needs you`,
    working: t`Working on it`,
    done: t`Done`,
  };
  const opened = openId ? tickets.find((ticket) => ticket.id === openId) : undefined;
  const openTicket = (ticket: Ticket | null) =>
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        if (ticket) next.set("ticket", ticket.id);
        else next.delete("ticket");
        return next;
      },
      { replace: true },
    );
  const dropped = (event: DragEvent, column: TaskColumnId) => {
    event.preventDefault();
    setOver(null);
    const ticket = tickets.find(
      (candidate) => candidate.id === event.dataTransfer.getData(DRAG_TYPE),
    );
    const status = ticket ? moveTarget(ticket, column) : null;
    if (ticket && status) move.run({ id: ticket.id, status });
  };
  const shownError = error || (move.error ? errorText(move.error) : "");

  return (
    <WorkspaceLayout
      page="tasks"
      title={<Trans>Tasks</Trans>}
      actions={
        <>
          {hasClosed ? (
            <Button
              variant="ghost"
              aria-pressed={showClosed}
              onClick={() => setShowClosed(!showClosed)}
            >
              {showClosed ? <Trans>Hide closed</Trans> : <Trans>Show closed</Trans>}
            </Button>
          ) : null}
          <Button onClick={() => setCreating(true)} disabled={bots.length === 0}>
            <Trans>New task</Trans>
          </Button>
        </>
      }
    >
      {shownError ? (
        <p role="alert" className="px-4 pt-3 text-body text-destructive">
          {shownError}
        </p>
      ) : null}
      <div
        data-testid="task-columns"
        className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {TASK_COLUMNS.map(({ id }) => {
          const cards = columns[id];
          const all = expanded.has(id);
          return (
            <section
              key={id}
              aria-label={titles[id]}
              data-testid={`task-column-${id}`}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOver(id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setOver(null);
              }}
              onDrop={(event) => dropped(event, id)}
              className={`min-w-0 space-y-2 rounded-xl p-2 ${over === id ? "bg-accent" : ""}`}
            >
              <SectionHeading
                as="h2"
                variant="label"
                className={`px-1 ${id === "needsYou" && cards.length > 0 ? "text-warning" : ""}`}
              >
                {titles[id]} <span className="font-normal">{cards.length}</span>
              </SectionHeading>
              {(all ? cards : cards.slice(0, COLUMN_PREVIEW)).map((ticket) => (
                <TaskCard
                  key={ticket.id}
                  ticket={ticket}
                  bot={bots.find((bot) => bot.id === ticket.assigneeBotId)}
                  onOpen={() => openTicket(ticket)}
                />
              ))}
              {cards.length > COLUMN_PREVIEW && !all ? (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setExpanded(new Set([...expanded, id]))}
                >
                  <Trans>Show all {cards.length}</Trans>
                  <span className="sr-only"> {titles[id]}</span>
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
      {tickets.length === 0 && !error ? (
        <p className="px-4 text-body text-muted-foreground">
          <Trans>No tickets yet</Trans>
        </p>
      ) : null}
      {creating || opened ? (
        <TicketDialog
          key={opened?.id ?? "new"}
          ticket={opened ?? null}
          bots={bots}
          onClose={() => (opened ? openTicket(null) : setCreating(false))}
          onSaved={reload}
        />
      ) : null}
    </WorkspaceLayout>
  );
}

function TaskCard({ ticket, bot, onOpen }: { ticket: Ticket; bot?: Bot; onOpen: () => void }) {
  return (
    <Button
      data-testid={`task-card-${ticket.id}`}
      variant="outline"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, ticket.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className="h-auto w-full flex-col items-start gap-1.5 whitespace-normal p-3 text-left font-normal"
    >
      <span className="text-label text-muted-foreground">{ticket.ref}</span>
      <span className="text-body font-medium">{ticket.title}</span>
      <span className="flex w-full items-center gap-1.5 text-label text-muted-foreground">
        {bot ? (
          <>
            <BotAvatar identity={bot.id} color={bot.color} avatarSet={bot.avatarSet} size={16} />
            <span className="min-w-0 truncate">{bot.name}</span>
          </>
        ) : (
          <Trans>Unassigned</Trans>
        )}
        <time dateTime={ticket.updatedAt} className="ms-auto shrink-0">
          {formatRelativeTime(ticket.updatedAt)}
        </time>
      </span>
    </Button>
  );
}
