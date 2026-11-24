export async function bestEffort<T>(
  label: string,
  attempt: PromiseLike<T> | undefined,
): Promise<T | undefined> {
  try {
    return await attempt;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      console.warn(`best effort failed: ${label}`, error);
    }
    return undefined;
  }
}
