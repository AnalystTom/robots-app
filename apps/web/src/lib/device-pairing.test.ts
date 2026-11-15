import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => text + part + (index < values.length ? values[index] : ""),
      "",
    ),
}));

import {
  capturePairingCode,
  pairedDeviceLabel,
  pairedDevicesChanged,
  pairingErrorText,
  pairingOrigins,
  pairingQr,
  takePairingCode,
  thisDeviceName,
} from "./device-pairing";

describe("capturing the code from the address", () => {
  it("takes the code out of the fragment and the history, once", () => {
    const history = { replaceState: vi.fn() };
    capturePairingCode({ pathname: "/pair", hash: "#token=abcd-efgh-jkmn" }, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/pair");
    expect(takePairingCode()).toBe("ABCDEFGHJKMN");
    expect(takePairingCode()).toBeNull();
  });

  it("still clears a fragment that holds no valid code", () => {
    const history = { replaceState: vi.fn() };
    capturePairingCode({ pathname: "/pair", hash: "#token=nope" }, history);
    expect(history.replaceState).toHaveBeenCalled();
    expect(takePairingCode()).toBeNull();
  });

  it("leaves other pages alone", () => {
    const history = { replaceState: vi.fn() };
    capturePairingCode({ pathname: "/app", hash: "#token=ABCDEFGHJKMN" }, history);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(takePairingCode()).toBeNull();
  });
});

describe("device names", () => {
  it("names a device from its browser when it sent no name", () => {
    expect(thisDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(thisDeviceName("Mozilla/5.0 (Linux; Android 15)")).toBe("Android");
    expect(pairedDeviceLabel({ name: "  ", userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe(
      "Windows",
    );
    expect(pairedDeviceLabel({ name: "Kitchen", userAgent: null })).toBe("Kitchen");
    expect(pairedDeviceLabel({ name: "", userAgent: null })).toBe("Device");
  });
});

describe("pairing origins", () => {
  it("offers the addresses the desktop app opened, or this page unless it is loopback", () => {
    expect(pairingOrigins(["http://192.168.1.5:45173"], "http://127.0.0.1:45173")).toEqual([
      "http://192.168.1.5:45173",
    ]);
    expect(pairingOrigins([], "http://127.0.0.1:45173")).toEqual([]);
    expect(pairingOrigins([], "https://robots.example.test")).toEqual([
      "https://robots.example.test",
    ]);
  });
});

it("draws a square QR code", () => {
  const qr = pairingQr("https://robots.example.test/pair#token=ABCDEFGHJKMN");
  expect(qr.size).toBeGreaterThanOrEqual(21);
  expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
});

it("explains the exchange's refusals", () => {
  expect(pairingErrorText({ code: "INVALID_PAIRING_CODE" })).toMatch(/not valid/);
  expect(pairingErrorText({ code: "PAIRING_RATE_LIMITED" })).toMatch(/Too many/);
  expect(pairingErrorText({ code: "UNTRUSTED_ORIGIN" })).toMatch(/not allowed/);
});

it("re-reads only the device list", async () => {
  const client = new QueryClient();
  const devices = [["user:1", "space:1", "devicePairing", "devices"], { type: "query" }];
  const other = [["user:1", "space:1", "spaces", "list"], { type: "query" }];
  client.setQueryData(devices, []);
  client.setQueryData(other, []);
  await pairedDevicesChanged(client);
  expect(client.getQueryState(devices)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});
