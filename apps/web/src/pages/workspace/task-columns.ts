import type { Ticket, TicketStatus } from "@robots/contracts";

/**
 * The Tasks board's columns over ticket statuses, in board order. A ticket dropped on a column
 * takes its first status; `closed` shows under Done only when asked for.
 */
export const TASK_COLUMNS = [
  { id: "notStarted", statuses: ["todo"] },
  { id: "working", statuses: ["doing"] },
  { id: "needsYou", statuses: ["review", "blocked"] },
  { id: "done", statuses: ["done", "closed"] },
] as const satisfies ReadonlyArray<{ id: string; statuses: readonly TicketStatus[] }>;

export type TaskColumn = (typeof TASK_COLUMNS)[number];
export type TaskColumnId = TaskColumn["id"];

/** Tickets needing the user's review or unblocking; Today lists them too. */
export const NEEDS_YOU_STATUSES: readonly TicketStatus[] = TASK_COLUMNS[2].statuses;

export function taskColumnOf(status: TicketStatus): TaskColumnId {
  const column = TASK_COLUMNS.find((candidate) =>
    (candidate.statuses as readonly TicketStatus[]).includes(status),
  );
  if (!column) throw new Error(`No column for ${status}`);
  return column.id;
}

/** The status a ticket takes when moved to `column`, or null when it is already there. */
export function moveTarget(ticket: Pick<Ticket, "status">, column: TaskColumnId) {
  if (taskColumnOf(ticket.status) === column) return null;
  const target = TASK_COLUMNS.find((candidate) => candidate.id === column);
  return (target?.statuses[0] ?? null) as TicketStatus | null;
}

/** Each column's tickets, most recently updated first; closed ones only with `showClosed`. */
export function taskColumns<T extends Pick<Ticket, "status" | "updatedAt">>(
  tickets: readonly T[],
  showClosed: boolean,
): Record<TaskColumnId, T[]> {
  const columns: Record<TaskColumnId, T[]> = {
    notStarted: [],
    needsYou: [],
    working: [],
    done: [],
  };
  const newest = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const ticket of newest) {
    if (ticket.status === "closed" && !showClosed) continue;
    columns[taskColumnOf(ticket.status)].push(ticket);
  }
  return columns;
}
