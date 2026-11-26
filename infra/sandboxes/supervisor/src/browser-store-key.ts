import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { retry } from "@robots/core";
import { browserStoreKey, WRITE_BROWSER_STORE_KEY_ARGV } from "@robots/core/node/browser-store-key";
import type Docker from "dockerode";
import { runContainerCommand } from "./exec.js";

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

export async function computerBrowserStoreKey(
  dataDir: string,
  computerKey: string,
): Promise<string> {
  return browserStoreKey(await master(dataDir), computerKey);
}

export function computerStoreKeyId(labels: Record<string, string> | undefined, fallback: string) {
  return labels?.["robots.botId"] || fallback;
}

const DELIVERY_ATTEMPTS = 4;
const DELIVERY_BACKOFF_MS = 500;

async function writeBrowserStoreKey(container: Docker.Container, key: string): Promise<void> {
  const result = await runContainerCommand(container, [...WRITE_BROWSER_STORE_KEY_ARGV], {
    signal: new AbortController().signal,
    stdin: `${key}\n`,
    timeoutMs: 10_000,
  });
  if (result.code !== 0) throw new Error("The browser's key could not be delivered.");
}

export async function deliverBrowserStoreKey(
  container: Docker.Container,
  dataDir: string,
  computerKey: string,
): Promise<void> {
  const key = await computerBrowserStoreKey(dataDir, computerKey);
  await retry(() => writeBrowserStoreKey(container, key), {
    attempts: DELIVERY_ATTEMPTS,
    retryable: () => true,
    delayMs: (attempt) => DELIVERY_BACKOFF_MS * 2 ** attempt,
  });
}
