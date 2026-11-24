import { Trans, useLingui } from "@lingui/react/macro";
import type { Ticket } from "@robots/contracts";
import { TICKET_STATUSES } from "@robots/contracts";
import { Button, buttonVariants } from "@robots/ui-web";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTicketStatusLabels } from "../lib/ticket-status";
import { TicketDialog } from "./board/TicketDialog";
import { useBoard } from "./board/use-board";
import { WindowChrome } from "./WindowChrome";

/** Every ticket status as its own column; Tasks is the everyday view of the same board. */
export function BoardPage() {
  const { t } = useLingui();
  const statuses = useTicketStatusLabels();
  const { tickets, bots, error, reload } = useBoard();
  const [selected, setSelected] = useState<Ticket | "new" | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to="/app"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={t`Back`}
        >
          <ChevronLeft />
        </Link>
        <h1 className="flex-1 font-medium">
          <Trans>Board</Trans>
        </h1>
        <Button onClick={() => setSelected("new")} disabled={bots.length === 0}>
          <Trans>New ticket</Trans>
        </Button>
      </header>
      {error ? (
        <p role="alert" className="px-4 py-2 text-body text-destructive">
          {error}
        </p>
      ) : null}
      <main className="relative min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div data-testid="board-columns" className="flex min-h-full gap-3">
          {TICKET_STATUSES.map((status) => (
            <section key={status} className="min-w-40 flex-1 space-y-2">
              <h2 className="px-1 text-body font-medium">{statuses[status]}</h2>
              {tickets
                .filter((ticket) => ticket.status === status)
                .map((ticket) => (
                  <Button
                    key={ticket.id}
                    data-testid={`board-card-${ticket.id}`}
                    variant="outline"
                    className="h-auto w-full flex-col items-start gap-1 whitespace-normal p-3 text-left font-normal"
                    onClick={() => setSelected(ticket)}
                  >
                    <span className="text-label text-muted-foreground">{ticket.ref}</span>
                    <span>{ticket.title}</span>
                    <span className="text-label text-muted-foreground">
                      {bots.find((bot) => bot.id === ticket.assigneeBotId)?.name}
                    </span>
                  </Button>
                ))}
            </section>
          ))}
        </div>
        {tickets.length === 0 && !error ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-body text-muted-foreground">
            <Trans>No tickets yet</Trans>
          </p>
        ) : null}
      </main>
      {selected ? (
        <TicketDialog
          key={selected === "new" ? "new" : selected.id}
          ticket={selected === "new" ? null : selected}
          bots={bots}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}
