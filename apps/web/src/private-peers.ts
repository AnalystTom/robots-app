import type { Socket } from "node:net";
import { isPrivateNetworkAddress } from "@robots/contracts/network-host";

/**
 * A peer on the person's own network: loopback, a LAN (RFC 1918), a private overlay network
 * (100.64.0.0/10 or IPv6 unique-local), as the socket reports it. An IPv4 peer on a dual-stack
 * listener arrives as `::ffff:a.b.c.d`.
 */
export function isPrivatePeer(address: string | undefined): boolean {
  if (!address) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return isPrivateNetworkAddress(mapped ? mapped[1]! : address);
}

/**
 * With `ROBOTS_WEB_PRIVATE_PEERS_ONLY=true`, a server listening on every interface closes any
 * connection from outside the person's own network before it reads a byte, so opening the web
 * port to the LAN never opens it to the internet too.
 */
export function attachPrivatePeerFilter(
  server: {
    httpServer: { on(event: "connection", listener: (socket: Socket) => void): unknown } | null;
  },
  enabled: boolean,
): void {
  if (!enabled) return;
  server.httpServer?.on("connection", (socket) => {
    if (!isPrivatePeer(socket.remoteAddress)) socket.destroy();
  });
}
