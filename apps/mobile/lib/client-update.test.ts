import type * as Contracts from "@robots/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => ({
  isEnabled: true,
  createdAt: new Date("2026-10-22T09:30:15Z") as Date | null,
  checkForUpdateAsync: vi.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: vi.fn(async () => ({ isNew: true })),
  reloadAsync: vi.fn(async () => {}),
}));
const rn = vi.hoisted(() => {
  const listeners: Array<(state: string) => void> = [];
  return {
    listeners,
    Alert: { alert: vi.fn() },
    AppState: {
      currentState: "active",
      addEventListener: vi.fn((_type: string, listener: (state: string) => void) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      }),
    },
    Linking: { openURL: vi.fn(async () => true) },
    Platform: { OS: "ios" },
  };
});

const links = vi.hoisted((): { ios?: string; android?: string } => ({}));

vi.mock("expo-updates", () => updates);
vi.mock("@robots/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  MOBILE_APP_LINKS: links,
}));
vi.mock("react-native", () => rn);
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  configureClientBuild: vi.fn(),
  currentApiBase: () => "https://server.example",
}));

import {
  clientBuildHeaders,
  FOREGROUND_UPDATE_CHECK_MS,
  mobileClientBuild,
  noteClientUpdateRequired,
  watchForegroundUpdates,
} from "./client-update";

afterEach(() => {
  delete links.ios;
  updates.isEnabled = true;
  updates.createdAt = new Date("2026-10-22T09:30:15Z");
  vi.clearAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function pressUpdate() {
  const buttons = rn.Alert.alert.mock.calls.at(-1)?.[2] as Array<{ onPress: () => void }>;
  buttons[0]?.onPress();
}

describe("mobile client build", () => {
  it("names the running bundle by when its update was created", () => {
    expect(mobileClientBuild()).toBe("20261022093015");
    expect(clientBuildHeaders()).toEqual({ "x-robots-client-build": "mobile/20261022093015" });
  });

  it("names no build where expo-updates is off", () => {
    updates.isEnabled = false;
    expect(clientBuildHeaders()).toEqual({});
    updates.isEnabled = true;
    updates.createdAt = null;
    expect(mobileClientBuild()).toBeNull();
  });
});

describe("update required", () => {
  it("applies an available update and reloads when no store lists RoBots", async () => {
    updates.checkForUpdateAsync.mockResolvedValueOnce({ isAvailable: true }).mockResolvedValueOnce({ isAvailable: true });
    noteClientUpdateRequired();
    noteClientUpdateRequired();
    await flush();
    expect(rn.Alert.alert).toHaveBeenCalledOnce();
    expect(rn.Alert.alert.mock.calls[0]?.[0]).toBe("Update required");
    expect(rn.Alert.alert.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ text: "Update" })]);
    expect(rn.Alert.alert.mock.calls[0]?.[3]).toEqual({ cancelable: false });
    pressUpdate();
    await flush();
    expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce();
    expect(updates.reloadAsync).toHaveBeenCalledOnce();
    expect(rn.Linking.openURL).not.toHaveBeenCalled();
  });

  it("opens the server's web app when no store lists RoBots and no update is available, and asks again", async () => {
    noteClientUpdateRequired();
    await flush();
    expect(rn.Alert.alert.mock.calls[0]?.[1]).toMatch(/not in the app store yet/);
    expect(rn.Alert.alert.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ text: "Open on the web" })]);
    pressUpdate();
    await flush();
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    expect(rn.Linking.openURL).toHaveBeenCalledWith("https://server.example");
    noteClientUpdateRequired();
    await flush();
    expect(rn.Alert.alert).toHaveBeenCalledTimes(2);
    pressUpdate();
    await flush();
  });

  it("opens the store once it is listed", async () => {
    links.ios = "https://ios.example/app";
    noteClientUpdateRequired();
    expect(rn.Alert.alert.mock.calls[0]?.[1]).toBeUndefined();
    expect(rn.Alert.alert.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ text: "Update" })]);
    pressUpdate();
    await flush();
    expect(rn.Linking.openURL).toHaveBeenCalledWith("https://ios.example/app");
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });
});

describe("foreground update checks", () => {
  it("downloads an update when the app returns from the background, at most every 15 minutes", async () => {
    let now = 0;
    const stop = watchForegroundUpdates(() => now);
    const emit = (state: string) => {
      for (const listener of [...rn.listeners]) listener(state);
    };
    updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    now = FOREGROUND_UPDATE_CHECK_MS;
    emit("inactive");
    emit("active");
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
    emit("background");
    emit("active");
    await flush();
    expect(updates.checkForUpdateAsync).toHaveBeenCalledOnce();
    expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    now += FOREGROUND_UPDATE_CHECK_MS - 1;
    emit("background");
    emit("active");
    expect(updates.checkForUpdateAsync).toHaveBeenCalledOnce();
    stop();
    expect(rn.listeners).toHaveLength(0);
  });
});
