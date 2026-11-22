import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computerBrowserStoreKey,
  computerStoreKeyId,
  deliverBrowserStoreKey,
} from "./browser-store-key.js";
import { runContainerCommand } from "./exec.js";

vi.mock("./exec.js", () => ({ runContainerCommand: vi.fn() }));

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "robots-browser-store-key-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("browser store key", () => {
  it("is stable for one computer and different for another", async () => {
    const first = await computerBrowserStoreKey(dataDir, "computer-a");
    expect(await computerBrowserStoreKey(dataDir, "computer-a")).toBe(first);
    expect(await computerBrowserStoreKey(dataDir, "computer-b")).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps its master secret beside the bot homes, never inside one", async () => {
    await computerBrowserStoreKey(dataDir, "computer-a");
    const master = join(dataDir, "secrets", "browser-store.key");
    expect((await stat(master)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dataDir, "secrets"))).mode & 0o777).toBe(0o700);
    expect((await readFile(master, "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names a computer by its home owner label", () => {
    expect(computerStoreKeyId({ "robots.botId": "home-1" }, "container-id")).toBe("home-1");
    expect(computerStoreKeyId(undefined, "container-id")).toBe("container-id");
  });

  it("retries a failed key delivery with backoff until the computer takes the key", async () => {
    const exec = vi.mocked(runContainerCommand);
    exec.mockReset();
    exec
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    await deliverBrowserStoreKey({} as Docker.Container, dataDir, "computer-a");
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[2]?.[2]?.stdin).toBe(
      `${await computerBrowserStoreKey(dataDir, "computer-a")}\n`,
    );
  }, 20_000);

  it("fails after every attempt when the computer never takes the key", async () => {
    const exec = vi.mocked(runContainerCommand);
    exec.mockReset();
    exec.mockResolvedValue({ code: 1, stdout: "", stderr: "" });
    await expect(
      deliverBrowserStoreKey({} as Docker.Container, dataDir, "computer-a"),
    ).rejects.toThrow("The browser's key could not be delivered.");
    expect(exec).toHaveBeenCalledTimes(4);
  }, 20_000);
});
