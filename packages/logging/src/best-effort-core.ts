export type BestEffortWarn = (label: string, error: unknown) => void;

export async function settleBestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
  warn: BestEffortWarn,
): Promise<T | undefined> {
  try {
    return await attempt;
  } catch (error) {
    if (!isAbort(error)) warn(label, error);
    return undefined;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
