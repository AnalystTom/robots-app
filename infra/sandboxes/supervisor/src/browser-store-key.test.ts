import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserStoreKey, computerStoreKeyId } from "./browser-store-key.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "robots-browser-store-key-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("browser store key", () => {
  it("is stable for one computer and different for another", async () => {
    const first = await browserStoreKey(dataDir, "computer-a");
    expect(await browserStoreKey(dataDir, "computer-a")).toBe(first);
    expect(await browserStoreKey(dataDir, "computer-b")).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps its master secret beside the bot homes, never inside one", async () => {
    await browserStoreKey(dataDir, "computer-a");
    const master = join(dataDir, "secrets", "browser-store.key");
    expect((await stat(master)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dataDir, "secrets"))).mode & 0o777).toBe(0o700);
    expect((await readFile(master, "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names a computer by its home owner label", () => {
    expect(computerStoreKeyId({ "robots.botId": "home-1" }, "container-id")).toBe("home-1");
    expect(computerStoreKeyId(undefined, "container-id")).toBe("container-id");
  });
});
