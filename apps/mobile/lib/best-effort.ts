export async function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  try {
    return await attempt;
  } catch (error) {
    if (!isAbort(error)) console.warn(`best effort failed: ${label}`, error);
    return undefined;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
