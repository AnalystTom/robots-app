import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "./tailscale-https.js";
import { createPrivateNetworkHttps, PrivateNetworkHttpsError } from "./tailscale-https.js";

const NAME = "box.example-tailnet.ts.net";
const running = {
  BackendState: "Running",
  Self: { DNSName: `${NAME}.`, CapMap: { https: null } },
  CertDomains: [NAME],
};

function cli(state: { status?: unknown; serve?: unknown; missing?: boolean }) {
  const calls: string[][] = [];
  const run: CommandRunner = vi.fn(async (_file, args) => {
    calls.push(args);
    if (state.missing) throw new PrivateNetworkHttpsError("missing");
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify(state.status ?? running) };
    if (args.join(" ") === "serve status --json")
      return { code: 0, stdout: JSON.stringify(state.serve ?? {}) };
    if (args[0] === "serve" && args.includes("--bg")) {
      state.serve = { Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: args.at(-1) } } } } };
      return { code: 0, stdout: "" };
    }
    if (args.at(-1) === "off") {
      state.serve = {};
      return { code: 0, stdout: "" };
    }
    return { code: 1, stdout: "" };
  });
  return { network: createPrivateNetworkHttps({ run }), calls, state };
}

const writes = (calls: string[][]) =>
  calls.filter((args) => args[0] === "serve" && args[1] !== "status");

describe("private network HTTPS", () => {
  it("reports the HTTPS origin when the network can issue a certificate", async () => {
    expect(await cli({}).network.inspect()).toEqual({ ready: true, origin: `https://${NAME}` });
  });

  it("says why it cannot publish", async () => {
    expect(await cli({ missing: true }).network.inspect()).toEqual({
      ready: false,
      reason: "missing",
    });
    expect(await cli({ status: { BackendState: "Stopped" } }).network.inspect()).toEqual({
      ready: false,
      reason: "stopped",
    });
    expect(
      await cli({
        status: { ...running, CertDomains: [], Self: { DNSName: `${NAME}.`, CapMap: {} } },
      }).network.inspect(),
    ).toEqual({ ready: false, reason: "no-https" });
    const taken = {
      Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } } },
    };
    expect(await cli({ serve: taken }).network.inspect()).toEqual({
      ready: false,
      reason: "in-use",
    });
  });

  it("publishes the local port once, and withdraws only its own", async () => {
    const f = cli({});
    expect(await f.network.publish(45173)).toEqual({ origin: `https://${NAME}` });
    expect(await f.network.publish(45173)).toEqual({ origin: `https://${NAME}` });
    expect(writes(f.calls)).toEqual([["serve", "--bg", "--https=443", "http://127.0.0.1:45173"]]);
    await f.network.withdraw(45173);
    expect(writes(f.calls).at(-1)).toEqual(["serve", "--https=443", "--set-path=/", "off"]);
  });

  it("refuses to replace what something else serves there", async () => {
    const taken = { Web: { [`${NAME}:443`]: { Handlers: { "/": { Path: "/srv/files" } } } } };
    const f = cli({ serve: taken });
    await expect(f.network.publish(45173)).rejects.toMatchObject({ reason: "in-use" });
    await f.network.withdraw(45173);
    expect(writes(f.calls)).toEqual([]);
  });
});
