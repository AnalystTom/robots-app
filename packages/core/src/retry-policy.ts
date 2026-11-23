export const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const { status } = error;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

export function isRetryableError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === undefined || status < 400) return true;
  return status >= 500 || status === 429 || status === 408;
}

export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : undefined;
}

export function jitterMs(ms: number, random: () => number = Math.random): number {
  return Math.round(ms - (random() * ms) / 2);
}

export function retryDelayMs(
  error: unknown,
  backoffMs: number,
  random: () => number = Math.random,
): number {
  const asked =
    typeof error === "object" && error !== null && "retryAfterMs" in error
      ? error.retryAfterMs
      : undefined;
  if (typeof asked === "number" && Number.isFinite(asked) && asked >= 0) {
    return Math.min(Math.max(asked, backoffMs), MAX_RETRY_AFTER_MS);
  }
  return error === undefined ? backoffMs : jitterMs(backoffMs, random);
}

export const STREAM_RETRY_BASE_MS = 1_000;

export const STREAM_RETRY_MAX_MS = 30_000;

export function streamRetryDelayMs(
  error: unknown,
  retry: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * 2 ** Math.max(retry, 0));
  return Math.max(retryDelayMs(error, 0), Math.round(random() * ceiling));
}

export const RECONNECT_SPREAD_MS = 5_000;

export function reconnectDelayMs(error: unknown, random: () => number = Math.random): number {
  return Math.max(retryDelayMs(error, 0), Math.round(random() * RECONNECT_SPREAD_MS));
}
