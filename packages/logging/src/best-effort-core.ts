export type BestEffortSink = (message: string, error: unknown) => void;

export async function settleBestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
  sink: BestEffortSink,
): Promise<T | undefined> {
  try {
    return await attempt;
  } catch (error) {
    if (!isAbort(error)) sink(`best effort failed: ${label}`, error);
    return undefined;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
