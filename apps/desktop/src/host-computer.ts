import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { startHostComputerServer } from "@robots/adapters/host-computer-server";
import { createHostDesktop } from "@robots/adapters/host-desktop";
import type { HostScreen } from "@robots/adapters/host-screen";
import type { MacApps } from "@robots/adapters/mac-apps-protocol";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

const DEFAULT_DISPLAY_START = 100;
const DEFAULT_SCREEN_PORT_START = 6180;

function wholeNumber(value: string | undefined, name: string, fallback: number, max: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    throw new Error(`${name} must be a whole number from 0 to ${max}`);
  return parsed;
}

function hostDesktopOptions(userDataDir: string, env: NodeJS.ProcessEnv) {
  return {
    toolsDir: env.ROBOTS_HOST_TOOLS_DIR || path.join(userDataDir, "host-tools"),
    displayStart: wholeNumber(
      env.ROBOTS_HOST_DISPLAY_START,
      "ROBOTS_HOST_DISPLAY_START",
      DEFAULT_DISPLAY_START,
      65535 - 9221,
    ),
    port: wholeNumber(
      env.ROBOTS_HOST_SCREEN_PORT_START,
      "ROBOTS_HOST_SCREEN_PORT_START",
      DEFAULT_SCREEN_PORT_START,
      65535,
    ),
  };
}

export async function prepareHostComputer(
  userDataDir: string,
  screen?: HostScreen,
  macApps?: MacApps,
) {
  const configFile = path.join(userDataDir, "host-computer.json");
  const consentFile = path.join(userDataDir, "host-computer-consent");
  const raw = await readPrivateFile(configFile, 1024);
  let token = randomBytes(32).toString("hex");
  let port = 0;
  try {
    const saved = JSON.parse(raw ?? "null");
    if (/^[a-f0-9]{64}$/.test(saved?.token)) token = saved.token;
    if (Number.isInteger(saved?.port) && saved.port >= 1024 && saved.port <= 65535)
      port = saved.port;
  } catch {}
  let server: Awaited<ReturnType<typeof startHostComputerServer>>;
  const root = path.join(userDataDir, "computers");
  const desktop = createHostDesktop(root, hostDesktopOptions(userDataDir, process.env));
  const options = { root, token, screen, macApps, desktop };
  try {
    server = await startHostComputerServer({ ...options, port });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
    token = randomBytes(32).toString("hex");
    server = await startHostComputerServer({ ...options, token });
  }
  try {
    await writePrivateFile(configFile, JSON.stringify({ token, port: server.port }));
  } catch (error) {
    await server.close();
    throw error;
  }
  let allowed = (await readPrivateFile(consentFile, 128)) === token;
  let active = false;
  let consentIntent = 0;
  let consentWrites: Promise<void> = Promise.resolve();
  function persistConsent(value: string) {
    const write = consentWrites.then(() =>
      writePrivateFile(consentFile, value).catch(async (error) => {
        if (value) throw error;
        await rm(consentFile, { force: true }).catch(() => {
          throw error;
        });
      }),
    );
    consentWrites = write.catch(() => undefined);
    return write;
  }
  return {
    connection: { url: `http://host.docker.internal:${server.port}`, token },
    isEnabled: server.isEnabled,
    activate(value: boolean) {
      active = value;
      server.setEnabled(active && allowed);
    },
    async grant() {
      const intent = ++consentIntent;
      await persistConsent(token);
      if (intent === consentIntent) {
        allowed = true;
        server.setEnabled(active);
      }
    },
    async revoke() {
      ++consentIntent;
      allowed = false;
      server.setEnabled(false);
      await persistConsent("");
    },
    close: server.close,
  };
}
