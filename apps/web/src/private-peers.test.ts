import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { attachPrivatePeerFilter, isPrivatePeer } from "./private-peers";

describe("private peers", () => {
  it("accepts this computer, the LAN and private overlay networks", () => {
    for (const address of [
      "127.0.0.1",
      "::1",
      "192.168.1.20",
      "::ffff:10.0.0.7",
      "172.16.4.2",
      "100.101.102.103",
      "fd7a:115c:a1e0::1",
    ])
      expect(isPrivatePeer(address), address).toBe(true);
  });

  it("refuses the internet, link-local, metadata and unknown peers", () => {
    for (const address of [
      "8.8.8.8",
      "::ffff:1.1.1.1",
      "2001:4860::8888",
      "169.254.169.254",
      "fe80::1",
      undefined,
    ])
      expect(isPrivatePeer(address), String(address)).toBe(false);
  });

  it("closes outside connections only when turned on", () => {
    const listen = () => {
      const httpServer = new EventEmitter();
      return { httpServer: httpServer as never as { on: EventEmitter["on"] }, emit: httpServer };
    };
    const socket = (remoteAddress: string) =>
      ({ remoteAddress, destroy: vi.fn() }) as unknown as Socket & {
        destroy: ReturnType<typeof vi.fn>;
      };

    const on = listen();
    attachPrivatePeerFilter(on, true);
    const outside = socket("203.0.113.9");
    const inside = socket("192.168.1.20");
    on.emit.emit("connection", outside);
    on.emit.emit("connection", inside);
    expect(outside.destroy).toHaveBeenCalled();
    expect(inside.destroy).not.toHaveBeenCalled();

    const off = listen();
    attachPrivatePeerFilter(off, false);
    const anyone = socket("203.0.113.9");
    off.emit.emit("connection", anyone);
    expect(anyone.destroy).not.toHaveBeenCalled();
  });
});
