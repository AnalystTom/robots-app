import { settleBestEffort } from "./best-effort-core.js";

export function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  return settleBestEffort(label, attempt, (failed, error) =>
    console.warn(`best effort failed: ${failed}`, error),
  );
}
