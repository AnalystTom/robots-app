import { z } from "zod";

/**
 * Pairing signs a new device in to the account that asked for a code. A code is 12 characters
 * from an alphabet without look-alikes (no 0, 1, I or O), about 60 bits: short enough to type,
 * far too many to guess within five minutes and a handful of tries.
 */
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 12;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** The device name a client may send with the code, as the device list shows it. */
export const PAIRED_DEVICE_NAME_MAX = 60;

/** The web page that finishes pairing. The code travels in the fragment, which no server sees. */
export const PAIR_PAGE_PATH = "/pair";
/** Exchanges a code for a session: a cookie for browsers, and the bearer token in the body. */
export const PAIRING_EXCHANGE_PATH = "/api/auth/pairing/exchange";
/** Public: which RoBots this is, so a client can check it before sending a code. */
export const ENVIRONMENT_PATH = "/.well-known/robots/environment";

export const EnvironmentSchema = z.object({ id: z.string().min(1).max(64) });
export type Environment = z.infer<typeof EnvironmentSchema>;

/** The code without separators or case, or null when it cannot be a code. */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of code) if (!PAIRING_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** Groups of four, for reading aloud or typing: `ABCD-EFGH-JKLM`. */
export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** The link to open on the new device; the code stays in the fragment. */
export function pairingLink(origin: string, code: string): string {
  return `${new URL(origin).origin}${PAIR_PAGE_PATH}#token=${encodeURIComponent(code)}`;
}

/** Opens the phone app's pairing screen for a pairing link. */
export function appPairingLink(link: string): string {
  return `robots://pair?url=${encodeURIComponent(link)}`;
}

/**
 * What someone pasted or scanned: a pairing link (web or app), or a bare code. `origin` is set
 * only for a link, and only for http(s).
 */
export function parsePairingInput(input: string): { origin?: string; code: string } | null {
  const value = input.trim();
  const bare = normalizePairingCode(value);
  if (bare) return { code: bare };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "robots:") {
    const inner = url.searchParams.get("url");
    return inner && !inner.startsWith("robots:") ? parsePairingInput(inner) : null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== PAIR_PAGE_PATH) return null;
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const code = token ? normalizePairingCode(token) : null;
  return code ? { origin: url.origin, code } : null;
}

export const PairingExchangeInput = z.object({
  code: z.string().min(1).max(64),
  deviceName: z.string().trim().max(PAIRED_DEVICE_NAME_MAX).optional(),
});
export type PairingExchangeInput = z.infer<typeof PairingExchangeInput>;

export const PairingCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});
export type PairingCode = z.infer<typeof PairingCodeSchema>;

export const PairedDeviceSchema = z.object({
  id: z.string(),
  /** The name the device sent, or empty; clients fall back to its browser or platform. */
  name: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  pairedAt: z.string(),
  lastSeenAt: z.string(),
  /** The device this request came from. */
  current: z.boolean(),
});
export type PairedDevice = z.infer<typeof PairedDeviceSchema>;
