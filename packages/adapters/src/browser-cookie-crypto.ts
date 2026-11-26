import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";

export type CookieCipherVersion = "v10" | "v11";

export type CookieKeys =
  | { cipher: "aes-128-cbc"; keys: Partial<Record<CookieCipherVersion, readonly Buffer[]>> }
  | { cipher: "aes-256-gcm"; key: Buffer };

export type BrowserSessionsErrorCode =
  | "unsupported_encryption"
  | "key_unavailable"
  | "key_locked"
  | "key_denied"
  | "wrong_key"
  | "profile_busy"
  | "profile_unreadable"
  | "profile_not_found";

export class BrowserSessionsError extends Error {
  constructor(
    readonly code: BrowserSessionsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrowserSessionsError";
  }
}

const KEY_SALT = "saltysalt";
const CBC_IV = Buffer.alloc(16, " ");
const HOST_HASH_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
export const HOST_HASH_DB_VERSION = 24;
export const LINUX_FIXED_PASSWORD = "peanuts";
export const LINUX_KEY_ITERATIONS = 1;
export const MAC_KEY_ITERATIONS = 1003;

export function cbcKey(password: string | Buffer, iterations: number): Buffer {
  return pbkdf2Sync(password, KEY_SALT, iterations, 16, "sha1");
}

export function linuxCookieKeys(keyringPasswords: readonly string[]): CookieKeys {
  const empty = cbcKey("", LINUX_KEY_ITERATIONS);
  return {
    cipher: "aes-128-cbc",
    keys: {
      v10: [cbcKey(LINUX_FIXED_PASSWORD, LINUX_KEY_ITERATIONS), empty],
      v11: [...keyringPasswords.map((password) => cbcKey(password, LINUX_KEY_ITERATIONS)), empty],
    },
  };
}

export function macCookieKeys(keychainPassword: string): CookieKeys {
  return { cipher: "aes-128-cbc", keys: { v10: [cbcKey(keychainPassword, MAC_KEY_ITERATIONS)] } };
}

export function windowsCookieKeys(masterKey: Buffer): CookieKeys {
  return { cipher: "aes-256-gcm", key: masterKey };
}

export interface EncryptedCookie {
  encrypted: Uint8Array;
  plain: string;
  hostKey: string;
  dbVersion: number;
}

export function cookieCipherVersion(encrypted: Uint8Array): string | undefined {
  if (encrypted.length === 0) return undefined;
  return Buffer.from(encrypted.subarray(0, 3)).toString("latin1");
}

export function isKnownCipherVersion(version: string): version is CookieCipherVersion {
  return version === "v10" || version === "v11";
}

export function unsupportedEncryption(version: string): BrowserSessionsError {
  return new BrowserSessionsError(
    "unsupported_encryption",
    version === "v20"
      ? "This browser locks its sign-ins to itself (app-bound encryption), so they cannot be imported."
      : `This browser encrypts sign-ins in a format RoBots cannot read (${printableVersion(version)}).`,
  );
}

function printableVersion(version: string): string {
  return /^[\x20-\x7e]{1,3}$/.test(version) ? version : "unknown";
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function cookieText(plaintext: Buffer, cookie: EncryptedCookie): string | undefined {
  let value = plaintext;
  if (cookie.dbVersion >= HOST_HASH_DB_VERSION) {
    if (value.length < HOST_HASH_BYTES) return undefined;
    const expected = createHash("sha256").update(cookie.hostKey).digest();
    if (!value.subarray(0, HOST_HASH_BYTES).equals(expected)) return undefined;
    value = value.subarray(HOST_HASH_BYTES);
  }
  try {
    const text = strictUtf8.decode(value);
    return hasControlCharacter(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

function cbcPlaintext(key: Buffer, body: Buffer): Buffer | undefined {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, CBC_IV);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return undefined;
  }
}

function gcmPlaintext(key: Buffer, body: Buffer): Buffer | undefined {
  if (body.length < GCM_NONCE_BYTES + GCM_TAG_BYTES) return undefined;
  try {
    const nonce = body.subarray(0, GCM_NONCE_BYTES);
    const tag = body.subarray(body.length - GCM_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(body.subarray(GCM_NONCE_BYTES, body.length - GCM_TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return undefined;
  }
}

export function decryptCookie(cookie: EncryptedCookie, keys: CookieKeys): string {
  const version = cookieCipherVersion(cookie.encrypted);
  if (version === undefined) return cookie.plain;
  if (!isKnownCipherVersion(version)) throw unsupportedEncryption(version);
  const body = Buffer.from(cookie.encrypted.subarray(3));
  const candidates =
    keys.cipher === "aes-256-gcm"
      ? [gcmPlaintext(keys.key, body)]
      : (keys.keys[version] ?? []).map((key) => cbcPlaintext(key, body));
  for (const plaintext of candidates) {
    const text = plaintext && cookieText(plaintext, cookie);
    if (text !== undefined) return text;
  }
  throw new BrowserSessionsError(
    "wrong_key",
    "The browser's saved key did not open its sign-ins. Sign in to the browser again and retry.",
  );
}
