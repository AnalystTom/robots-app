import type { NetworkInterfaceInfo } from "node:os";
import type { DesktopNetworkMode, DesktopNetworkState } from "@robots/contracts";
import { isDesktopNetworkMode } from "@robots/contracts";
import type { NetworkEnv } from "./local-stack.js";
import {
  networkPlan,
  privateAddresses,
  readNetworkMode,
  writeNetworkMode,
} from "./network-access.js";

/** The private network HTTPS capability, as `@robots/adapters/private-network-https` offers it. */
export interface PrivateHttps {
  inspect(): Promise<{ ready: true; origin: string } | { ready: false; reason: string }>;
  publish(port: number): Promise<{ origin: string }>;
  withdraw(port: number): Promise<void>;
}

export interface NetworkControllerDeps {
  stackDir: string;
  interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  https: PrivateHttps;
  /** The web port of the stack on this computer. */
  port: () => string;
  /** Stops and starts the stack so its new address takes effect; resolves once it is back. */
  restart: () => Promise<void>;
  /** The person's own answer, from a native prompt the page cannot answer, before opening up. */
  confirm: (address: string) => Promise<boolean>;
}

/**
 * Who on the network can open the stack this app runs. The mode is saved beside the stack and
 * applied whenever it starts; changing it restarts the stack. Errors are codes the page words.
 */
export function createNetworkController(deps: NetworkControllerDeps) {
  let mode: DesktopNetworkMode = "off";
  let httpsOrigin: string | null = null;
  let error: string | null = null;
  let changing: Promise<DesktopNetworkState> | null = null;
  const loaded = readNetworkMode(deps.stackDir).then(async (saved) => {
    mode = saved;
    if (saved !== "private-https") return;
    // Published by an earlier run; the private network keeps it across restarts.
    // Unreachable just leaves the address unknown until the page asks again.
    const status = await deps.https.inspect().catch(() => null);
    if (status?.ready) httpsOrigin = status.origin;
  });
  const plan = (existing: { origins?: string; hosts?: string } = {}, port = deps.port()) =>
    networkPlan(mode, {
      port,
      addresses: privateAddresses(deps.interfaces()),
      httpsOrigin,
      existing,
    });
  const state = async (): Promise<DesktopNetworkState> => {
    await loaded;
    const available: DesktopNetworkMode[] = ["off"];
    if (privateAddresses(deps.interfaces()).length) available.push("local");
    const https = await deps.https.inspect().catch(() => null);
    // A mode in use stays listed even while its network is down, so the page can show it.
    if (https?.ready || mode === "private-https") available.push("private-https");
    if (!available.includes(mode)) available.push(mode);
    return { mode, available, urls: plan().urls, error };
  };
  const apply = async (next: DesktopNetworkMode): Promise<DesktopNetworkState> => {
    await loaded;
    if (next === mode) return state();
    const port = Number(deps.port());
    let origin: string | null = null;
    if (next === "private-https") {
      const status = await deps.https.inspect();
      if (!status.ready) {
        error = status.reason;
        return state();
      }
      origin = status.origin;
    }
    const address =
      next === "local" ? privateAddresses(deps.interfaces()).join(", ") : (origin ?? "");
    if (next !== "off" && !(await deps.confirm(address))) return state();
    if (mode === "private-https") await deps.https.withdraw(port);
    mode = next;
    httpsOrigin = origin;
    error = null;
    await writeNetworkMode(deps.stackDir, next);
    await deps.restart();
    if (next === "private-https") {
      try {
        httpsOrigin = (await deps.https.publish(port)).origin;
      } catch (failure) {
        error =
          failure && typeof failure === "object" && "reason" in failure
            ? String(failure.reason)
            : "failed";
      }
    }
    return state();
  };
  return {
    /** Read by the stack controllers each time they start the stack. */
    env: ((input) => plan(input.existing, input.port).env) satisfies NetworkEnv,
    /** Waits for the saved mode, so the first start already applies it. */
    ready: () => loaded,
    state,
    /** One change at a time; a second request while one runs gets that one's answer. */
    setMode(next: unknown): Promise<DesktopNetworkState> {
      if (!isDesktopNetworkMode(next)) return state();
      if (changing) return changing;
      changing = apply(next).finally(() => {
        changing = null;
      });
      return changing;
    },
  };
}

export type NetworkController = ReturnType<typeof createNetworkController>;
