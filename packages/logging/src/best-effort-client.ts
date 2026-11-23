import type { BestEffortSink } from "./best-effort-core.js";
import { settleBestEffort } from "./best-effort-core.js";

let sink: BestEffortSink = (message, error) => console.warn(message, error);

export function installBestEffortSink(next: BestEffortSink): void {
  sink = next;
}

export function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  return settleBestEffort(label, attempt, (message, error) => sink(message, error));
}
