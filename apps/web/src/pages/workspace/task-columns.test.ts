import type { TicketStatus } from "@robots/contracts";
import { TICKET_STATUSES } from "@robots/contracts";
import { describe, expect, it } from "vitest";
import { moveTarget, taskColumnOf, taskColumns } from "./task-columns";

describe("task columns", () => {
  it("maps every ticket status to a Robots column", () => {
    expect(
      Object.fromEntries(TICKET_STATUSES.map((status) => [status, taskColumnOf(status)])),
    ).toEqual({
      todo: "notStarted",
      doing: "working",
      review: "needsYou",
      blocked: "needsYou",
      done: "done",
      closed: "done",
    });
  });

  it("groups tickets newest first and hides closed ones unless asked", () => {
    const ticket = (id: string, status: TicketStatus, updatedAt: string) => ({
      id,
      status,
      updatedAt,
    });
    const tickets = [
      ticket("a", "review", "2026-11-15T09:00:00Z"),
      ticket("b", "blocked", "2026-11-15T10:00:00Z"),
      ticket("c", "closed", "2026-11-15T11:00:00Z"),
      ticket("d", "done", "2026-11-15T08:00:00Z"),
      ticket("e", "todo", "2026-11-15T08:00:00Z"),
    ];
    const ids = (showClosed: boolean) =>
      Object.fromEntries(
        Object.entries(taskColumns(tickets, showClosed)).map(([column, rows]) => [
          column,
          rows.map((row) => row.id),
        ]),
      );
    expect(ids(false)).toEqual({
      notStarted: ["e"],
      needsYou: ["b", "a"],
      working: [],
      done: ["d"],
    });
    expect(ids(true).done).toEqual(["c", "d"]);
  });

  it("moves into a column's first status and leaves a ticket already there alone", () => {
    expect(moveTarget({ status: "todo" }, "needsYou")).toBe("review");
    expect(moveTarget({ status: "review" }, "working")).toBe("doing");
    expect(moveTarget({ status: "doing" }, "done")).toBe("done");
    expect(moveTarget({ status: "done" }, "notStarted")).toBe("todo");
    expect(moveTarget({ status: "blocked" }, "needsYou")).toBeNull();
    expect(moveTarget({ status: "closed" }, "done")).toBeNull();
  });
});
