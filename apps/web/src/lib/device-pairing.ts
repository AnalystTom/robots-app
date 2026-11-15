import { t } from "@lingui/core/macro";
import type { PairedDevice } from "@robots/contracts";
import {
  isLoopbackHost,
  PAIR_PAGE_PATH,
  PAIRED_DEVICE_NAME_MAX,
  PAIRING_EXCHANGE_PATH,
  parsePairingInput,
} from "@robots/contracts";
import { readBoundedJsonResponse } from "@robots/core";
import qrcode from "qrcode-generator";
import { queryClient } from "./query";
import { authErrorText } from "./user-error";

let pendingCode: string | null = null;

/**
 * Takes a pairing code out of `/pair#token=…` before anything else reads the address, and
 * removes it from the address bar and history, so it is never reported, synced or shared.
 * Runs once, before the app renders.
 */
export function capturePairingCode(
  location: Pick<Location, "pathname" | "hash"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
): void {
  if (location.pathname !== PAIR_PAGE_PATH || !location.hash) return;
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", PAIR_PAGE_PATH);
  pendingCode = token ? (parsePairingInput(token)?.code ?? null) : null;
}

/** The code the page was opened with, handed out once. */
export function takePairingCode(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}

/** A short name for this device from what the browser says about itself. */
export function thisDeviceName(userAgent = navigator.userAgent): string {
  return (deviceKind(userAgent) ?? "").slice(0, PAIRED_DEVICE_NAME_MAX);
}

function deviceKind(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/CrOS/.test(userAgent)) return "ChromeOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

/** What the device list shows for a device: its name, or what its browser said it was. */
export function pairedDeviceLabel(device: Pick<PairedDevice, "name" | "userAgent">): string {
  return device.name.trim() || deviceKind(device.userAgent) || t`Device`;
}

/** Spends a code on this browser: on success the session cookie is set. */
export async function exchangePairingCode(code: string): Promise<void> {
  const response = await fetch(PAIRING_EXCHANGE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName: thisDeviceName() || undefined }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;
  let error: unknown;
  try {
    error = await readBoundedJsonResponse<unknown>(response, 64 * 1024);
  } catch {
    // Gateways may answer with HTML or nothing.
  }
  throw new Error(pairingErrorText(error));
}

export function pairingErrorText(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "INVALID_PAIRING_CODE") return t`This code is not valid. Create a new one.`;
  if (code === "PAIRING_RATE_LIMITED") return t`Too many tries. Wait a few minutes.`;
  if (code === "UNTRUSTED_ORIGIN") return t`This address is not allowed to sign in.`;
  return authErrorText(error, t`Could not pair this device`);
}

/**
 * Where another device can open this server. In a browser that is this page's own origin; the
 * desktop app passes the addresses it opened to the network instead.
 */
export function pairingOrigins(shared: readonly string[], here = window.location.origin): string[] {
  if (shared.length) return [...shared];
  try {
    return isLoopbackHost(new URL(here).hostname) ? [] : [here];
  } catch {
    return [];
  }
}

/** The QR code as SVG path data on a square of `size` modules, drawn dark on light. */
export function pairingQr(text: string): { size: number; path: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1)
    for (let column = 0; column < size; column += 1)
      if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
  return { size, path };
}

/** Re-reads the device list wherever it is shown, as after a device pairs elsewhere. */
export function pairedDevicesChanged(client = queryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: ({ queryKey: [path] }) =>
      Array.isArray(path) && path.slice(-2).join(".") === "devicePairing.devices",
  });
}
