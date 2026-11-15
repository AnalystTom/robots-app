import type { NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import type { DesktopNetworkMode } from "@robots/contracts";
import { isDesktopNetworkMode } from "@robots/contracts";
import { isPrivateNetworkAddress } from "@robots/contracts/network-host";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/** Where the chosen mode is kept, beside the stack it applies to. */
export const NETWORK_MODE_FILE = ".desktop-network-mode";

export async function readNetworkMode(stackDir: string): Promise<DesktopNetworkMode> {
  const mode = (await readPrivateFile(path.join(stackDir, NETWORK_MODE_FILE), 64))?.trim();
  return isDesktopNetworkMode(mode) ? mode : "off";
}

export function writeNetworkMode(stackDir: string, mode: DesktopNetworkMode): Promise<void> {
  return writePrivateFile(path.join(stackDir, NETWORK_MODE_FILE), mode);
}

/**
 * This computer's IPv4 addresses on private networks: the LAN first, then private overlay
 * networks (100.64.0.0/10). Loopback, link-local and public addresses are left out.
 */
export function privateAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces))
    for (const entry of entries ?? [])
      if (entry.family === "IPv4" && !entry.internal && isPrivateNetworkAddress(entry.address))
        found.add(entry.address);
  const overlay = (address: string) => /^100\./.test(address);
  return [...found].sort((a, b) => Number(overlay(a)) - Number(overlay(b)) || a.localeCompare(b));
}

export interface NetworkPlan {
  /** Added to the stack's environment; empty keeps it on this computer. */
  env: Record<string, string>;
  /** What another device opens, best first. */
  urls: string[];
}

/**
 * How the stack runs for a mode. `local` listens on every interface but the web server closes
 * connections from outside private networks, and only the addresses listed here may sign in.
 * `private-https` keeps the stack on loopback: the private network's HTTPS proxy reaches it
 * there. `existing` is what the person's own `.env` already trusts, which is kept.
 */
export function networkPlan(
  mode: DesktopNetworkMode,
  input: {
    port: string;
    addresses: string[];
    httpsOrigin: string | null;
    existing?: { origins?: string; hosts?: string };
  },
): NetworkPlan {
  const join = (current: string | undefined, added: string[]) =>
    [...new Set([...(current ?? "").split(",").map((value) => value.trim()), ...added])]
      .filter(Boolean)
      .join(",");
  if (mode === "local" && input.addresses.length) {
    const urls = input.addresses.map((address) => `http://${address}:${input.port}`);
    return {
      urls,
      env: {
        ROBOTS_WEB_BIND: "0.0.0.0",
        ROBOTS_WEB_PRIVATE_PEERS_ONLY: "true",
        ROBOTS_EXTRA_AUTH_ORIGINS: join(input.existing?.origins, urls),
        ROBOTS_ALLOWED_HOSTS: join(input.existing?.hosts, input.addresses),
      },
    };
  }
  if (mode === "private-https" && input.httpsOrigin) {
    return {
      urls: [input.httpsOrigin],
      env: {
        ROBOTS_EXTRA_AUTH_ORIGINS: join(input.existing?.origins, [input.httpsOrigin]),
        ROBOTS_ALLOWED_HOSTS: join(input.existing?.hosts, [new URL(input.httpsOrigin).hostname]),
      },
    };
  }
  return { env: {}, urls: [] };
}
