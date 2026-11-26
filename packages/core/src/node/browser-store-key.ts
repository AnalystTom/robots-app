import { createHmac } from "node:crypto";

export const BROWSER_STORE_KEY_PATH = "/tmp/robots/browser-store-key";

export const WRITE_BROWSER_STORE_KEY_ARGV: readonly string[] = [
  "sh",
  "-c",
  `umask 077 && mkdir -p /tmp/robots && IFS= read -r key && printf '%s' "$key" > "$0.next" && mv -f "$0.next" "$0"`,
  BROWSER_STORE_KEY_PATH,
];

export function browserStoreKey(master: Buffer | string, computerKey: string): string {
  return createHmac("sha256", master).update(`browser-store:${computerKey}`).digest("base64url");
}

export function browserStoreSecret(encryptionKey: string): string {
  return createHmac("sha256", encryptionKey).update("robots:browser-store:v1").digest("hex");
}
