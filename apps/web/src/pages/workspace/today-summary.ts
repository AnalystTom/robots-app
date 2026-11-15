import type { RunActivityRow } from "@robots/contracts";

/** Which greeting fits the hour: before noon, before six, then evening. */
export function dayPart(hour: number): "morning" | "afternoon" | "evening" {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/** The first word of the account's name, or nothing when it has none. */
export function firstName(name: string | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

/** The start of the user's local day, as the timestamp Today's reads take. */
export function startOfDay(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** Each working bot's name once, in the order its runs come. */
export function workingBotNames(runs: readonly Pick<RunActivityRow, "botName">[]): string[] {
  return [...new Set(runs.map((run) => run.botName))];
}
