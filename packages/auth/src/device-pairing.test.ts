import { createHash } from "node:crypto";
import {
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
} from "@robots/contracts";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import {
  consumePairingCode,
  createPairingAttemptLimiter,
  devicePairing,
  generatePairingCode,
  issuePairingCode,
  PAIRED_DEVICE_FIELD,
  PAIRING_CODE_PREFIX,
} from "./device-pairing.js";

const IP_HEADER = "x-test-client-ip";
const ORIGIN = "http://web.example.test";

describe("pairing codes", () => {
  it("draws 12 characters from the unambiguous alphabet", () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const char of code) expect(PAIRING_CODE_ALPHABET).toContain(char);
    }
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it("redraws bytes past the last full alphabet so no character is favoured", () => {
    // 256 is a multiple of 32, so every byte is used; a 30-letter alphabet would skip 240-255.
    const bytes = [0, 31, 32, 255, ...Array.from({ length: 20 }, (_, index) => index)];
    let offset = 0;
    const code = generatePairingCode((size) => {
      const chunk = Uint8Array.from(bytes.slice(offset, offset + size));
      offset += size;
      return chunk;
    });
    expect(code.slice(0, 4)).toBe("2Z2Z");
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
  });

  it("reads codes typed with spaces, dashes or lower case, and refuses anything else", () => {
    expect(normalizePairingCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizePairingCode(" ABCD EFGH JKMN ")).toBe("ABCDEFGHJKMN");
    expect(normalizePairingCode("ABCDEFGHJKM")).toBeNull();
    expect(normalizePairingCode("ABCDEFGHJKM0")).toBeNull();
    expect(normalizePairingCode("ABCDEFGHJKMNP")).toBeNull();
    expect(formatPairingCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });
});

/** A verification table that behaves like Better Auth's: consuming reads and deletes at once. */
function verificationStore() {
  const rows = new Map<string, { value: string; expiresAt: Date }>();
  return {
    rows,
    createVerificationValue: async (data: { identifier: string; value: string; expiresAt: Date }) =>
      rows.set(data.identifier, { value: data.value, expiresAt: data.expiresAt }),
    consumeVerificationValue: async (identifier: string) => {
      const row = rows.get(identifier) ?? null;
      rows.delete(identifier);
      return row;
    },
  };
}

describe("issuing and consuming", () => {
  it("returns the account once, and never after", async () => {
    const store = verificationStore();
    const { code, expiresAt } = await issuePairingCode(store, "user-1", 1_000);
    expect(expiresAt.getTime()).toBe(1_000 + PAIRING_CODE_TTL_MS);
    expect(await consumePairingCode(store, formatPairingCode(code).toLowerCase(), 2_000)).toBe(
      "user-1",
    );
    expect(await consumePairingCode(store, code, 2_000)).toBeNull();
  });

  it("refuses an expired code and spends it anyway", async () => {
    const store = verificationStore();
    const { code } = await issuePairingCode(store, "user-1", 0);
    expect(await consumePairingCode(store, code, PAIRING_CODE_TTL_MS)).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  it("does not look up input that cannot be a code", async () => {
    const store = verificationStore();
    const consume = vi.spyOn(store, "consumeVerificationValue");
    expect(await consumePairingCode(store, "not a code")).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("attempt limiter", () => {
  it("blocks an address after five wrong codes until the window passes", () => {
    let now = 0;
    const limiter = createPairingAttemptLimiter({ now: () => now });
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.blocked("10.0.0.2")).toBe(false);
      limiter.failed("10.0.0.2");
    }
    expect(limiter.blocked("10.0.0.2")).toBe(true);
    expect(limiter.blocked("10.0.0.3")).toBe(false);
    now = 15 * 60_000;
    expect(limiter.blocked("10.0.0.2")).toBe(false);
  });

  it("blocks everyone once wrong codes add up across addresses", () => {
    const limiter = createPairingAttemptLimiter({ total: 3 });
    for (const address of ["a", "b", "c"]) limiter.failed(address);
    expect(limiter.blocked("d")).toBe(true);
  });
});

function fixture(options: { onPaired?: (userId: string) => void; trusted?: string[] } = {}) {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const auth = betterAuth({
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL: "http://auth.example.test",
    trustedOrigins: [ORIGIN, ...(options.trusted ?? [])],
    database: memoryAdapter(data),
    emailAndPassword: { enabled: true },
    verification: {
      storeIdentifier: { default: "plain", overrides: { [PAIRING_CODE_PREFIX]: "hashed" } },
    },
    advanced: { ipAddress: { ipAddressHeaders: [IP_HEADER] } },
    plugins: [
      bearer({ requireSignature: true }),
      devicePairing({ clientIpHeader: IP_HEADER, onPaired: options.onPaired }),
    ],
  });
  const exchange = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    auth.handler(
      new Request("http://auth.example.test/api/auth/pairing/exchange", {
        method: "POST",
        headers: { "content-type": "application/json", [IP_HEADER]: "10.0.0.9", ...headers },
        body: JSON.stringify(body),
      }),
    );
  const owner = async () => {
    const response = await auth.api.signUpEmail({
      body: { email: "owner@example.test", password: "offline-password12", name: "Owner" },
    });
    return response.user.id;
  };
  const issue = async (userId: string) =>
    issuePairingCode((await auth.$context).internalAdapter, userId);
  return { auth, data, exchange, owner, issue };
}

describe("exchange endpoint", () => {
  it("signs the device in to the code's account with a cookie and a bearer token", async () => {
    const onPaired = vi.fn();
    const f = fixture({ onPaired });
    const userId = await f.owner();
    const { code } = await f.issue(userId);
    // Only the hash of the code is stored.
    const identifiers = f.data.verification!.map((row) => String(row.identifier));
    expect(identifiers.some((identifier) => identifier.includes(code))).toBe(false);

    const response = await f.exchange({ code: formatPairingCode(code), deviceName: "Phone" });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/);
    const body = (await response.json()) as { token: string; user: { id: string } };
    expect(body.user.id).toBe(userId);
    expect(onPaired).toHaveBeenCalledWith(userId);

    const paired = f.data.session!.find((session) => session[PAIRED_DEVICE_FIELD] === "Phone");
    expect(paired?.userId).toBe(userId);
    expect(paired?.ipAddress).toBe("10.0.0.9");
    const session = await f.auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${response.headers.get("set-auth-token")}` }),
    });
    expect(session?.user.id).toBe(userId);
  });

  it("marks the cookie Secure when the device came over HTTPS", async () => {
    const secureOrigin = "https://box.private.example";
    const untrusted = fixture();
    const first = await untrusted.issue(await untrusted.owner());
    // Refused until the deployment lists the address.
    expect((await untrusted.exchange({ code: first.code }, { origin: secureOrigin })).status).toBe(
      403,
    );
    const f = fixture({ trusted: [secureOrigin] });
    const { code } = await f.issue(await f.owner());
    const response = await f.exchange({ code }, { origin: secureOrigin });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  });

  it("works once per code", async () => {
    const f = fixture();
    const { code } = await f.issue(await f.owner());
    expect((await f.exchange({ code })).status).toBe(200);
    const again = await f.exchange({ code });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: "INVALID_PAIRING_CODE" });
  });

  it("refuses an expired code", async () => {
    const f = fixture();
    const userId = await f.owner();
    const { code } = await issuePairingCode(
      (await f.auth.$context).internalAdapter,
      userId,
      Date.now() - PAIRING_CODE_TTL_MS - 1,
    );
    expect((await f.exchange({ code })).status).toBe(400);
    expect(f.data.session!.some((session) => session[PAIRED_DEVICE_FIELD] !== undefined)).toBe(
      false,
    );
  });

  it("refuses a page on another site, and accepts a native app that sends no origin", async () => {
    const f = fixture();
    const userId = await f.owner();
    const { code } = await f.issue(userId);
    expect((await f.exchange({ code }, { origin: "https://attacker.example" })).status).toBe(403);
    // The refused request did not spend the code.
    expect((await f.exchange({ code }, {})).status).toBe(200);
  });

  it("stops a client after repeated wrong codes, even with a right one", async () => {
    const f = fixture();
    const { code } = await f.issue(await f.owner());
    for (let index = 0; index < 5; index += 1)
      expect((await f.exchange({ code: "ABCD-EFGH-JKMN" })).status).toBe(400);
    const limited = await f.exchange({ code });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "PAIRING_RATE_LIMITED" });
  });

  it("gives a code only to the account that issued it", async () => {
    const f = fixture();
    const owner = await f.owner();
    const other = await f.auth.api.signUpEmail({
      body: { email: "other@example.test", password: "offline-password12", name: "Other" },
    });
    const { code } = await f.issue(other.user.id);
    const body = (await (await f.exchange({ code })).json()) as { user: { id: string } };
    expect(body.user.id).toBe(other.user.id);
    expect(body.user.id).not.toBe(owner);
  });

  it("hashes stored codes with SHA-256", async () => {
    const f = fixture();
    const { code } = await f.issue(await f.owner());
    const digest = createHash("sha256").update(`${PAIRING_CODE_PREFIX}${code}`).digest();
    const stored = f.data.verification!.map((row) => String(row.identifier));
    expect(
      stored.some(
        (identifier) =>
          identifier === digest.toString("base64url") || identifier === digest.toString("hex"),
      ),
    ).toBe(true);
  });
});
