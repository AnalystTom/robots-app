import { settleBestEffort } from "./best-effort-core.js";
import { getLogger } from "./logger.js";

export function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  return settleBestEffort(label, attempt, (message, error) => getLogger().warn(message, { error }));
}
