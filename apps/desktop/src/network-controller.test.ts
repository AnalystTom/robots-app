import { mkdtemp, rm } from "node:fs/promises";
import type { NetworkInterfaceInfo } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readNetworkMode } from "./network-access.js";
import type { PrivateHttps } from "./network-controller.js";
import { createNetworkController } from "./network-controller.js";

const lan = {
  wlan0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
} as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;
const ORIGIN = "https://box.example-net.test";

describe("network controller", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "robots-network-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function setup(inspect?: PrivateHttps["inspect"], answer = true) {
    const deps = {
      stackDir: root,
      interfaces: () => lan,
      https: {
        inspect: vi.fn<PrivateHttps["inspect"]>(
          inspect ?? (async () => ({ ready: true, origin: ORIGIN })),
        ),
        publish: vi.fn(async (_port: number) => ({ origin: ORIGIN })),
        withdraw: vi.fn(async (_port: number) => undefined),
      },
      port: () => "45173",
      restart: vi.fn(async () => undefined),
      confirm: vi.fn(async () => answer),
    };
    return { deps, network: createNetworkController(deps) };
  }

  it("starts off, offering what this computer can do", async () => {
    const { network } = setup();
    expect(await network.state()).toEqual({
      mode: "off",
      available: ["off", "local", "private-https"],
      urls: [],
      error: null,
    });
    expect(network.env({ port: "45173", existing: {} })).toEqual({});
  });

  it("opens to the local network only after the person allows it, then restarts", async () => {
    const refused = setup(undefined, false);
    expect((await refused.network.setMode("local")).mode).toBe("off");
    expect(refused.deps.restart).not.toHaveBeenCalled();

    const { deps, network } = setup();
    const state = await network.setMode("local");
    expect(deps.confirm).toHaveBeenCalledWith("192.168.1.20");
    expect(deps.restart).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ mode: "local", urls: ["http://192.168.1.20:45173"] });
    expect(await readNetworkMode(root)).toBe("local");
    expect(network.env({ port: "45173", existing: {} }).ROBOTS_WEB_BIND).toBe("0.0.0.0");
    // Going back needs no prompt.
    expect((await network.setMode("off")).mode).toBe("off");
    expect(deps.confirm).toHaveBeenCalledOnce();
  });

  it("publishes over private network HTTPS after the restart, and withdraws when leaving", async () => {
    const { deps, network } = setup();
    const state = await network.setMode("private-https");
    expect(deps.https.publish).toHaveBeenCalledWith(45173);
    expect(deps.restart.mock.invocationCallOrder[0]).toBeLessThan(
      deps.https.publish.mock.invocationCallOrder[0]!,
    );
    expect(state).toMatchObject({ mode: "private-https", urls: [ORIGIN], error: null });
    await network.setMode("off");
    expect(deps.https.withdraw).toHaveBeenCalledWith(45173);
  });

  it("keeps the mode and says why when private network HTTPS is not ready", async () => {
    const { deps, network } = setup(async () => ({ ready: false, reason: "in-use" }));
    const state = await network.setMode("private-https");
    expect(state).toMatchObject({ mode: "off", error: "in-use", available: ["off", "local"] });
    expect(deps.restart).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("ignores modes it does not know and runs one change at a time", async () => {
    const { deps, network } = setup();
    expect((await network.setMode("everyone")).mode).toBe("off");
    const [first, second] = await Promise.all([network.setMode("local"), network.setMode("off")]);
    expect(first).toBe(second);
    expect(deps.restart).toHaveBeenCalledOnce();
  });
});
