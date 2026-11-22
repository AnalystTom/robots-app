import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Docker from "dockerode";
import { runContainerCommand } from "./exec.js";

export const BROWSER_STORE_KEY_PATH = "/tmp/robots/browser-store-key";
const MASTER_FILE = "browser-store.key";

const masters = new Map<string, Promise<Buffer>>();

async function readOrCreateMaster(dataDir: string): Promise<Buffer> {
  const dir = join(dataDir, "secrets");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, MASTER_FILE);
  try {
    await writeFile(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const hex = (await readFile(file, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("The browser store key is unreadable.");
  return Buffer.from(hex, "hex");
}

function master(dataDir: string): Promise<Buffer> {
  let found = masters.get(dataDir);
  if (!found) {
    found = readOrCreateMaster(dataDir);
    masters.set(dataDir, found);
    found.catch(() => masters.delete(dataDir));
  }
  return found;
}

export async function browserStoreKey(dataDir: string, computerKey: string): Promise<string> {
  return createHmac("sha256", await master(dataDir))
    .update(`browser-store:${computerKey}`)
    .digest("base64url");
}

export function computerStoreKeyId(labels: Record<string, string> | undefined, fallback: string) {
  return labels?.["robots.botId"] || fallback;
}

export async function deliverBrowserStoreKey(
  container: Docker.Container,
  dataDir: string,
  computerKey: string,
): Promise<void> {
  const key = await browserStoreKey(dataDir, computerKey);
  const result = await runContainerCommand(
    container,
    [
      "sh",
      "-c",
      `umask 077 && mkdir -p /tmp/robots && IFS= read -r key && printf '%s' "$key" > "$0.next" && mv -f "$0.next" "$0"`,
      BROWSER_STORE_KEY_PATH,
    ],
    { signal: new AbortController().signal, stdin: `${key}\n`, timeoutMs: 10_000 },
  );
  if (result.code !== 0) throw new Error("The browser's key could not be delivered.");
}
