import { execFile } from "node:child_process";

/**
 * Publishes a port on this computer at an HTTPS name on a private overlay network, so devices
 * signed in to the same network reach it with a real certificate and nobody else reaches it.
 * The desktop app asks for it by capability; this is the one implementation, through the
 * Tailscale CLI's `serve`.
 */
export interface PrivateNetworkHttps {
  /** Whether this computer can publish now, and at which origin. Reads only. */
  inspect(): Promise<PrivateNetworkHttpsStatus>;
  /** Proxies the HTTPS name to `http://127.0.0.1:<port>`. Refuses to replace someone else's. */
  publish(port: number): Promise<{ origin: string }>;
  /** Stops publishing, but only what `publish(port)` set up. */
  withdraw(port: number): Promise<void>;
}

export type PrivateNetworkHttpsStatus =
  | { ready: true; origin: string }
  /**
   * `missing`: no CLI. `stopped`: installed but not connected. `no-https`: the network has
   * HTTPS names turned off. `in-use`: its HTTPS port already serves something else.
   */
  | { ready: false; reason: "missing" | "stopped" | "no-https" | "in-use" };

export class PrivateNetworkHttpsError extends Error {
  constructor(readonly reason: Exclude<PrivateNetworkHttpsStatus, { ready: true }>["reason"]) {
    super(`Private network HTTPS unavailable: ${reason}`);
  }
}

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ code: number; stdout: string }>;

const HTTPS_PORT = "443";
const COMMAND_TIMEOUT_MS = 15_000;

const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error && "code" in error && error.code === "ENOENT") {
          reject(new PrivateNetworkHttpsError("missing"));
          return;
        }
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout) });
      },
    );
  });

const target = (port: number) => `http://127.0.0.1:${port}`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The machine's name on the network, if HTTPS certificates can be issued for it. */
function httpsName(status: unknown): string | null | "stopped" {
  const root = record(status);
  if (root.BackendState !== "Running") return "stopped";
  const self = record(root.Self);
  const name = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
  const certDomains = Array.isArray(root.CertDomains) ? root.CertDomains : [];
  const capabilities = record(self.CapMap);
  if (!name || !(certDomains.includes(name) || "https" in capabilities)) return null;
  return name;
}

/** What the HTTPS port proxies `/` to now, or null when it serves nothing. */
function servedTarget(serve: unknown, name: string): string | null {
  const web = record(record(serve).Web);
  const site = record(web[`${name}:${HTTPS_PORT}`]);
  const root = record(record(site.Handlers)["/"]);
  if (typeof root.Proxy === "string") return root.Proxy;
  // Anything else at that address (files, text, other paths) is someone else's.
  return Object.keys(record(site.Handlers)).length ? "other" : null;
}

export function createPrivateNetworkHttps(
  options: { run?: CommandRunner; binary?: string } = {},
): PrivateNetworkHttps {
  const run = options.run ?? runCommand;
  const binary = options.binary ?? "tailscale";
  const json = async (args: string[]): Promise<unknown> => {
    const { code, stdout } = await run(binary, args);
    if (code !== 0) return null;
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  };
  const name = async () => {
    const status = await json(["status", "--json"]);
    if (status === null) throw new PrivateNetworkHttpsError("stopped");
    const found = httpsName(status);
    if (found === "stopped") throw new PrivateNetworkHttpsError("stopped");
    if (!found) throw new PrivateNetworkHttpsError("no-https");
    return found;
  };
  const served = async (host: string) =>
    servedTarget(await json(["serve", "status", "--json"]), host);
  const inspect = async (port?: number): Promise<PrivateNetworkHttpsStatus> => {
    try {
      const host = await name();
      const current = await served(host);
      if (current && (port === undefined || current !== target(port)))
        return { ready: false, reason: "in-use" };
      return { ready: true, origin: `https://${host}` };
    } catch (error) {
      if (error instanceof PrivateNetworkHttpsError) return { ready: false, reason: error.reason };
      throw error;
    }
  };
  return {
    inspect: () => inspect(),
    async publish(port) {
      const status = await inspect(port);
      if (!status.ready) throw new PrivateNetworkHttpsError(status.reason);
      const host = new URL(status.origin).hostname;
      if ((await served(host)) === target(port)) return { origin: status.origin };
      const { code } = await run(binary, ["serve", "--bg", `--https=${HTTPS_PORT}`, target(port)]);
      if (code !== 0) throw new PrivateNetworkHttpsError("no-https");
      return { origin: status.origin };
    },
    async withdraw(port) {
      let host: string;
      try {
        host = await name();
      } catch (error) {
        // Not connected, so nothing is published to withdraw.
        if (error instanceof PrivateNetworkHttpsError) return;
        throw error;
      }
      if ((await served(host)) !== target(port)) return;
      await run(binary, ["serve", `--https=${HTTPS_PORT}`, "--set-path=/", "off"]);
    },
  };
}
