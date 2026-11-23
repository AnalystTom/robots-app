import { settleBestEffort } from "./best-effort-core.js";
import { getLogger } from "./logger.js";

export function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  return settleBestEffort(label, attempt, (failed, error) =>
    getLogger().warn(`best effort failed: ${failed}`, { error }),
  );
}
