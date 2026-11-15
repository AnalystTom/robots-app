import { randomBytes } from "node:crypto";
import {
  normalizePairingCode,
  PAIRED_DEVICE_NAME_MAX,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PairingExchangeInput,
} from "@robots/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

/** Stored hashed (see `verification.storeIdentifier`), so the table never holds a usable code. */
export const PAIRING_CODE_PREFIX = "device-pairing-";

/** The session column that marks a sign-in made with a code, holding the device's name. */
export const PAIRED_DEVICE_FIELD = "pairedDevice";

/** A code is the alphabet's characters drawn uniformly: bytes past the last full alphabet are redrawn. */
export function generatePairingCode(random: (size: number) => Uint8Array = randomBytes): string {
  const size = PAIRING_CODE_ALPHABET.length;
  const limit = 256 - (256 % size);
  let code = "";
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of random(PAIRING_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += PAIRING_CODE_ALPHABET[byte % size];
      if (code.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return code;
}

type Verification = { value: string; expiresAt: Date };

export async function issuePairingCode(
  adapter: {
    createVerificationValue(data: Verification & { identifier: string }): Promise<unknown>;
  },
  userId: string,
  now = Date.now(),
): Promise<{ code: string; expiresAt: Date }> {
  const code = generatePairingCode();
  const expiresAt = new Date(now + PAIRING_CODE_TTL_MS);
  await adapter.createVerificationValue({
    identifier: `${PAIRING_CODE_PREFIX}${code}`,
    value: JSON.stringify({ userId }),
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * The account a code was issued for, or null. Consuming deletes the row in the same statement
 * that reads it, so of two devices racing with one code only one gets an account; an expired
 * code is spent as well.
 */
export async function consumePairingCode(
  adapter: { consumeVerificationValue(identifier: string): Promise<Verification | null> },
  input: string,
  now = Date.now(),
): Promise<string | null> {
  const code = normalizePairingCode(input);
  if (!code) return null;
  const stored = await adapter.consumeVerificationValue(`${PAIRING_CODE_PREFIX}${code}`);
  if (!stored || stored.expiresAt.getTime() <= now) return null;
  try {
    const parsed: unknown = JSON.parse(stored.value);
    const userId =
      parsed && typeof parsed === "object" && "userId" in parsed ? parsed.userId : undefined;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}

/**
 * Wrong codes per client address, and in total, within a window. A code has about 60 bits, so
 * this is not what keeps codes safe; it stops a client from trying at all once it has failed a
 * few times, and records nothing about the codes it sent. Kept per process: the database-backed
 * rate limit (`authRateLimitOptions`) bounds the exchange across processes in production.
 */
export function createPairingAttemptLimiter(
  options: { perAddress?: number; total?: number; windowMs?: number; now?: () => number } = {},
) {
  const { perAddress = 5, total = 100, windowMs = 15 * 60_000, now = Date.now } = options;
  const failures = new Map<string, number[]>();
  let all: number[] = [];
  const recent = (times: number[] | undefined) =>
    (times ?? []).filter((at) => now() - at < windowMs);
  return {
    blocked(address: string): boolean {
      all = recent(all);
      return all.length >= total || recent(failures.get(address)).length >= perAddress;
    },
    failed(address: string) {
      const at = now();
      all = [...recent(all), at];
      failures.set(address, [...recent(failures.get(address)), at]);
      // Addresses with no recent failure are forgotten, so the map stays as small as the window.
      if (failures.size > 10_000) {
        for (const [key, times] of failures) if (!recent(times).length) failures.delete(key);
      }
    },
  };
}

export type PairingAttemptLimiter = ReturnType<typeof createPairingAttemptLimiter>;

const invalidCode = () =>
  new APIError("BAD_REQUEST", { code: "INVALID_PAIRING_CODE", message: "Invalid pairing code" });

/**
 * `POST /pairing/exchange`: spends a code and signs this device in to the code's account with
 * an ordinary session, marked as paired so the account can list and revoke it. Browsers get the
 * session cookie; the body carries the token too, which the bearer hook signs for native apps.
 */
export function devicePairing(options: {
  /** The header the API sets from the socket peer, so a caller cannot pick its own address. */
  clientIpHeader: string;
  limiter?: PairingAttemptLimiter;
  /** After a device paired, so the account's open screens re-read their devices. */
  onPaired?: (userId: string) => Promise<void> | void;
}): BetterAuthPlugin {
  const limiter = options.limiter ?? createPairingAttemptLimiter();
  return {
    id: "device-pairing",
    schema: {
      session: {
        fields: { [PAIRED_DEVICE_FIELD]: { type: "string", required: false, input: false } },
      },
    },
    endpoints: {
      pairingExchange: createAuthEndpoint(
        "/pairing/exchange",
        { method: "POST", body: PairingExchangeInput, requireHeaders: true },
        async (ctx) => {
          // A page on another site must not sign this browser in to someone's account. Native
          // apps send no Origin; the code alone is their credential.
          const origin = ctx.headers?.get("origin");
          if (origin !== null && origin !== undefined && !ctx.context.isTrustedOrigin(origin)) {
            throw new APIError("FORBIDDEN", {
              code: "UNTRUSTED_ORIGIN",
              message: "Invalid origin",
            });
          }
          const address = ctx.headers?.get(options.clientIpHeader) || "unknown";
          if (limiter.blocked(address)) {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "PAIRING_RATE_LIMITED",
              message: "Too many attempts. Create a new code and try again later.",
            });
          }
          const userId = await consumePairingCode(ctx.context.internalAdapter, ctx.body.code);
          const user = userId ? await ctx.context.internalAdapter.findUserById(userId) : null;
          if (!user) {
            limiter.failed(address);
            throw invalidCode();
          }
          const name = (ctx.body.deviceName ?? "").slice(0, PAIRED_DEVICE_NAME_MAX);
          const session = await ctx.context.internalAdapter.createSession(user.id, false, {
            [PAIRED_DEVICE_FIELD]: name,
          });
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
          // Secure whenever the device reached this server over HTTPS, as through a private
          // network's HTTPS name in front of a plain-HTTP origin.
          const secure = origin?.startsWith("https:") ? { secure: true } : undefined;
          await setSessionCookie(ctx, { session, user }, false, secure);
          await options.onPaired?.(user.id);
          return ctx.json({
            token: session.token,
            user: { id: user.id, email: user.email, name: user.name },
          });
        },
      ),
    },
  };
}
