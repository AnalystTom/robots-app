import { createCipheriv, createHash } from "node:crypto";
import type { CookieCipherVersion, CookieKeys } from "./browser-cookie-crypto.js";
import { HOST_HASH_DB_VERSION } from "./browser-cookie-crypto.js";

const CBC_IV = Buffer.alloc(16, " ");
const GCM_NONCE = Buffer.alloc(12, 7);

export function encryptCookieForTest(
  value: string,
  cookie: { hostKey: string; dbVersion: number; version: CookieCipherVersion },
  keys: CookieKeys,
): Buffer {
  const prefix = cookie.dbVersion >= HOST_HASH_DB_VERSION;
  const plaintext = Buffer.concat([
    prefix ? createHash("sha256").update(cookie.hostKey).digest() : Buffer.alloc(0),
    Buffer.from(value, "utf8"),
  ]);
  if (keys.cipher === "aes-256-gcm") {
    const cipher = createCipheriv("aes-256-gcm", keys.key, GCM_NONCE);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from(cookie.version), GCM_NONCE, body, cipher.getAuthTag()]);
  }
  const key = keys.keys[cookie.version]?.[0];
  if (!key) throw new Error(`no ${cookie.version} key`);
  const cipher = createCipheriv("aes-128-cbc", key, CBC_IV);
  return Buffer.concat([Buffer.from(cookie.version), cipher.update(plaintext), cipher.final()]);
}
