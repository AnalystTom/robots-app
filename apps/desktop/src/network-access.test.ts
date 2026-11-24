import { mkdtemp, rm } from "node:fs/promises";
import type { NetworkInterfaceInfo } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDocker } from "./docker-cli.js";
import { LocalStackController } from "./local-stack.js";
import {
  networkPlan,
  privateAddresses,
  readNetworkMode,
  writeNetworkMode,
} from "./network-access.js";

const COMPOSE_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "infra", "compose");

const nic = (address: string, patch: Partial<NetworkInterfaceInfo> = {}) =>
  ({ address, family: "IPv4", internal: false, ...patch }) as NetworkInterfaceInfo;

describe("private addresses", () => {
  it("lists LAN addresses first and private overlay addresses after, nothing public", () => {
    expect(
      privateAddresses({
        lo: [nic("127.0.0.1", { internal: true })],
        overlay0: [nic("100.101.102.103")],
        wlan0: [nic("192.168.1.20"), nic("fe80::1", { family: "IPv6" })],
        eth1: [nic("203.0.113.9")],
        docker0: [nic("10.0.0.1")],
        link: [nic("169.254.10.10")],
      }),
    ).toEqual(["10.0.0.1", "192.168.1.20", "100.101.102.103"]);
  });
});

describe("network plan", () => {
  const input = { port: "45173", addresses: ["192.168.1.20"], httpsOrigin: null };

  it("keeps the stack on this computer when off", () => {
    expect(networkPlan("off", input)).toEqual({ env: {}, urls: [] });
  });

  it("listens on every interface for the local network, closed to public peers", () => {
    expect(
      networkPlan("local", {
        ...input,
        existing: { origins: "https://mine.example.test", hosts: "mine.example.test" },
      }),
    ).toEqual({
      urls: ["http://192.168.1.20:45173"],
      env: {
        ROBOTS_WEB_BIND: "0.0.0.0",
        ROBOTS_WEB_PRIVATE_PEERS_ONLY: "true",
        ROBOTS_EXTRA_AUTH_ORIGINS: "https://mine.example.test,http://192.168.1.20:45173",
        ROBOTS_ALLOWED_HOSTS: "mine.example.test,192.168.1.20",
      },
    });
    // No private address: nothing to open to.
    expect(networkPlan("local", { ...input, addresses: [] })).toEqual({ env: {}, urls: [] });
  });

  it("stays on loopback behind the private network's HTTPS name", () => {
    const origin = "https://box.example-net.test";
    expect(networkPlan("private-https", { ...input, httpsOrigin: origin })).toEqual({
      urls: [origin],
      env: { ROBOTS_EXTRA_AUTH_ORIGINS: origin, ROBOTS_ALLOWED_HOSTS: "box.example-net.test" },
    });
  });
});

describe("saved mode and the stack", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "robots-network-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("remembers the mode and reads anything else as off", async () => {
    expect(await readNetworkMode(root)).toBe("off");
    await writeNetworkMode(root, "local");
    expect(await readNetworkMode(root)).toBe("local");
  });

  it("starts the stack with the network's environment, and again when it changes", async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const run: RunDocker = vi.fn(async (_binary, args, options) => {
      calls.push({ args, env: options.env });
      if (args[0] === "compose" && args[1] === "version")
        return { code: 0, stdout: "2.29.0\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
    let network: Record<string, string> = {};
    const seen: string[] = [];
    const stack = new LocalStackController({
      platform: "linux",
      env: { PATH: "/usr/bin", HOME: "/home/me" },
      exists: (file) => file === "/usr/bin/docker",
      stackDir: path.join(root, "stack"),
      resourceDir: COMPOSE_DIR,
      localWebUrl: "http://127.0.0.1:5173",
      imageTag: "v1.2.3",
      randomHex: (bytes) => "ab".repeat(bytes),
      sleep: async () => undefined,
      healthTimeoutMs: 50,
      run,
      probe: async () => "v1.2.3",
      networkEnv: ({ port }) => {
        seen.push(port);
        return network;
      },
    });
    expect((await stack.start()).phase).toBe("ready");
    expect(await stack.matchesDesiredStack()).toBe(true);
    network = { ROBOTS_WEB_BIND: "0.0.0.0", ROBOTS_WEB_PRIVATE_PEERS_ONLY: "true" };
    // A stack started on loopback does not serve the network until it starts again.
    expect(await stack.matchesDesiredStack()).toBe(false);
    expect((await stack.start()).phase).toBe("ready");
    const up = calls.filter((call) => call.args[7] === "up").at(-1);
    expect(up?.env).toMatchObject(network);
    expect(await stack.matchesDesiredStack()).toBe(true);
    expect(seen.at(-1)).toBe("5173");
  });
});
