import type { AdapterContext, ComputerRef } from "@robots/adapter-kit";
import { BROWSER_STORE_KEY_PATH, browserStoreSecret } from "@robots/core/node/browser-store-key";
import { describe, expect, it, vi } from "vitest";
import type { RawExec } from "./exec-computer.js";
import { ExecComputer, encodeTarEntry, TarReader } from "./exec-computer.js";

const context: AdapterContext = {
  operationId: "op-1",
  traceId: "trace-1",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

function computer(botId: string): ComputerRef {
  return { id: `computer-${botId}`, botId, kind: "local-vm", providerRef: `vm-${botId}` };
}

function recordingTransport() {
  const keys: { botId: string; key: string }[] = [];
  const exec: RawExec = async function* (ref, command, _signal, _timeoutMs, stdin) {
    if (command.includes(BROWSER_STORE_KEY_PATH)) {
      let key = "";
      for await (const chunk of stdin ?? []) key += String(chunk);
      keys.push({ botId: ref.botId, key: key.trim() });
    }
    yield { type: "exit", code: 0 };
  };
  return { exec, keys };
}

describe("computer browser key", () => {
  const secret = browserStoreSecret("deployment-encryption-key");

  it("gives a restarted computer the same key and another computer a different one", async () => {
    const before = recordingTransport();
    await new ExecComputer(before.exec, "VM", secret).prepare(computer("bot-a"), context);
    const after = recordingTransport();
    const restarted = new ExecComputer(after.exec, "VM", secret);
    await restarted.prepare(computer("bot-a"), context);
    await restarted.prepare(computer("bot-b"), context);

    expect(before.keys).toHaveLength(1);
    expect(before.keys[0]!.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(after.keys[0]).toEqual(before.keys[0]);
    expect(after.keys[1]!.botId).toBe("bot-b");
    expect(after.keys[1]!.key).not.toBe(before.keys[0]!.key);
  });

  it("refuses to start when the computer does not take its key", async () => {
    const exec: RawExec = async function* (_ref, command) {
      yield { type: "exit", code: command.includes(BROWSER_STORE_KEY_PATH) ? 1 : 0 };
    };
    await expect(
      new ExecComputer(exec, "VM", secret).prepare(computer("bot-a"), context),
    ).rejects.toThrow("browser key");
  });
});

describe("workspace archive packets", () => {
  it("reads a large file without repeatedly copying its accumulated bytes", () => {
    const content = Buffer.alloc(8 * 1024 * 1024, 173);
    const archive = Buffer.concat([
      ...encodeTarEntry("large.bin", content, false),
      ...encodeTarEntry("next.txt", Buffer.from("next"), true),
      Buffer.alloc(1024),
    ]);
    const concat = Buffer.concat;
    let copiedBytes = 0;
    const spy = vi.spyOn(Buffer, "concat").mockImplementation((chunks, length) => {
      copiedBytes += chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      return concat(chunks, length);
    });
    try {
      const reader = new TarReader(content.length);
      const files = [];
      for (let offset = 0; offset < archive.length; offset += 16381) {
        files.push(...reader.push(archive.subarray(offset, offset + 16381)));
      }
      reader.finish();
      expect(files.map((file) => file.path)).toEqual(["large.bin", "next.txt"]);
      expect(Buffer.compare(Buffer.from(files[0]!.content), content)).toBe(0);
      expect(Buffer.from(files[1]!.content).toString()).toBe("next");
      expect(files[1]!.executable).toBe(true);
      expect(copiedBytes).toBeLessThanOrEqual(archive.length * 2);
    } finally {
      spy.mockRestore();
    }
  });

  it("handles split headers, long paths, empty files and padding", () => {
    const name = `${"directory/".repeat(15)}file.txt`;
    const archive = Buffer.concat([
      ...encodeTarEntry("empty", Buffer.alloc(0), false),
      ...encodeTarEntry(name, Buffer.from("abc"), false),
      Buffer.alloc(1024),
    ]);
    const reader = new TarReader(10);
    const files = [];
    for (const byte of archive) files.push(...reader.push(Buffer.from([byte])));
    reader.finish();
    expect(files.map((file) => file.path)).toEqual(["empty", name]);
    expect(files[0]!.content.length).toBe(0);
    expect(Buffer.from(files[1]!.content).toString()).toBe("abc");
  });

  it("rejects truncated bodies and oversized files", () => {
    const archive = Buffer.concat([...encodeTarEntry("file", Buffer.from("abc"), false)]);
    const reader = new TarReader(3);
    reader.push(archive.subarray(0, 513));
    expect(() => reader.finish()).toThrow("ended inside a file");
    expect(() => new TarReader(2).push(archive)).toThrow("exceeds");
  });
});
