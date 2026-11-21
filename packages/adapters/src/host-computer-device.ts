import type { PrismaClient } from "@robots/db";
import type { HostComputerAccess } from "./host-computer-access.js";
import { hostComputerGate } from "./host-computer-access.js";
import type { HostComputerEnvironment, HostComputerRequest } from "./host-computer-protocol.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { UserDeviceOfflineError } from "./user-device-gateway.js";
import type { UserDevice, UserDeviceGateway } from "./user-device-protocol.js";

export const HOST_COMPUTER_DEVICE_ID = "this-computer";

export function withHostComputerScreen(
  devices: UserDeviceGateway | undefined,
  options: {
    prisma: PrismaClient;
    sandboxKind: string;
    url?: string;
    token?: string;
    access: HostComputerAccess | undefined;
  },
): UserDeviceGateway | undefined {
  const { url, token } = options;
  if (options.sandboxKind !== "docker" || !url || !token) return devices;
  const host = new HostComputerSandbox(url, token);
  const gate = hostComputerGate(options.prisma, options.access);

  async function hostDevice(userId: string): Promise<UserDevice | null> {
    if (!(await gate.forUser(userId))) return null;
    try {
      let environment: HostComputerEnvironment | undefined;
      for await (const value of host.stream<HostComputerEnvironment>(
        { method: "environment", botId: HOST_COMPUTER_DEVICE_ID },
        AbortSignal.timeout(5_000),
      ))
        environment = value;
      return environment
        ? {
            deviceId: HOST_COMPUTER_DEVICE_ID,
            name: "This computer",
            platform: environment.platform,
            screenOnly: true,
          }
        : null;
    } catch {
      return null;
    }
  }

  return {
    async connected(userId) {
      return (await devices?.connected(userId)) ?? hostDevice(userId);
    },
    async pairedSince(userId) {
      return (await devices?.pairedSince(userId)) ?? gate.forUser(userId);
    },
    async *request<T>(
      userId: string,
      request: HostComputerRequest,
      signal: AbortSignal,
      deviceId?: string,
    ): AsyncIterable<T> {
      if (deviceId !== HOST_COMPUTER_DEVICE_ID) {
        if (!devices) throw new UserDeviceOfflineError();
        yield* devices.request<T>(userId, request, signal, deviceId);
        return;
      }
      if (request.method !== "screenObserve" && request.method !== "screenAct")
        throw new Error("Only screen control reaches this computer this way");
      if (!(await gate.forUser(userId))) throw new UserDeviceOfflineError();
      yield* host.stream<T>(request, signal);
    },
  };
}
