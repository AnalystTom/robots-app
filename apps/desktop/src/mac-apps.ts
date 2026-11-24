import { spawn } from "node:child_process";
import path from "node:path";
import type { MacAppCall, MacApps } from "@robots/adapters/mac-apps-protocol";
import { MacAppError } from "@robots/adapters/mac-apps-protocol";
import type { MacGrantId } from "@robots/contracts";
import { MAC_GRANTS, macAppToolEntry } from "@robots/contracts";
import {
  AUTOMATION_PROBE_SCRIPT,
  LOCATION_STATUS_SCRIPT,
  MAC_TOOL_SCRIPTS,
} from "./mac-apps-scripts.js";
import { chatDatabaseAccess, listChats, openChatDatabase, readChat } from "./mac-messages-db.js";
import type { MacPermissions } from "./mac-permissions.js";
import {
  AE_NOT_PERMITTED,
  AE_TARGET_NOT_RUNNING,
  automationErrorCode,
  createMacPermissions,
  fileAccessStatus,
} from "./mac-permissions.js";

export type ScriptRunner = (script: string, args: string[], signal: AbortSignal) => Promise<string>;

const SCRIPT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const LOCATION_TIMEOUT_MS = 20_000;
const PROMPT_TIMEOUT_MS = 120_000;

export const osascript: ScriptRunner = (script, args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-", ...args], {
      signal,
      timeout: SCRIPT_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && size <= MAX_OUTPUT_BYTES) resolve(Buffer.concat(stdout).toString("utf8"));
      else
        reject(
          new Error(Buffer.concat(stderr).toString("utf8").trim() || `osascript exited ${code}`),
        );
    });
    child.stdin.end(script);
  });

export function normalizedHandle(value: string): string {
  return value.includes("@") ? value.trim() : value.replace(/[\s().-]/g, "");
}

function scriptArgs(call: MacAppCall): unknown {
  if (call.tool === "mac_location_current") return { timeoutMs: LOCATION_TIMEOUT_MS };
  if (call.tool === "mac_messages_send" && call.args.to)
    return { ...call.args, to: normalizedHandle(call.args.to) };
  return call.args;
}

const NOUNS: Record<string, string> = {
  mail: "email",
  messages: "chat",
  notes: "note",
  reminders: "reminder or list",
  calendar: "calendar",
  contacts: "contact",
};

const ROBOTS_FAILURES: Record<string, (app: string) => string> = {
  "no-account": () => "Messages has no account signed in on this Mac.",
  "not-sent": () => "Mail did not send the email. Ask the user to check Mail.",
  "location-off": () =>
    "Location Services is off on this Mac. Ask the user to turn it on in System Settings > Privacy & Security > Location Services.",
  "location-denied": () =>
    "RoBots is not allowed to use this Mac's location. Ask the user to allow Location for RoBots in its Mac connections.",
  "location-timeout": () => "This Mac could not find its location in time. Try again later.",
};

function grantHint(grant: MacGrantId, app: string) {
  return `RoBots is not allowed to control ${app} on this Mac. Ask the user to click Allow next to ${app} in RoBots' Mac connections, or turn on ${app} for RoBots in System Settings > Privacy & Security > ${MAC_GRANTS[grant].pane}.`;
}

export function macAppFailure(call: MacAppCall, error: unknown): MacAppError {
  const entry = macAppToolEntry(call.tool)!;
  const app = entry.app.name;
  const text = error instanceof Error ? error.message : String(error);
  const robots = /ROBOTS:([a-z-]+)/.exec(text)?.[1];
  if (robots === "not-found")
    return new MacAppError(`That ${NOUNS[entry.app.id] ?? "item"} was not found in ${app}.`);
  if (robots && ROBOTS_FAILURES[robots]) return new MacAppError(ROBOTS_FAILURES[robots](app));
  const code = automationErrorCode(error);
  if (code === AE_NOT_PERMITTED) return new MacAppError(grantHint(entry.tool.grants[0]!, app));
  if (code === -1728 || code === -1719)
    return new MacAppError(`That ${NOUNS[entry.app.id] ?? "item"} was not found in ${app}.`);
  if (code === AE_TARGET_NOT_RUNNING)
    return new MacAppError(`${app} did not open. Ask the user to open it once, then try again.`);
  if (code === -1712) return new MacAppError(`${app} took too long to answer. Try again.`);
  return new MacAppError(`${app} could not do that on this Mac.`);
}

export const FULL_DISK_ACCESS_MESSAGE =
  "RoBots needs Full Disk Access to read Messages. Ask the user to turn on RoBots in System Settings > Privacy & Security > Full Disk Access, then quit and reopen RoBots.";

export function createMacApps(deps: {
  home: string;
  runScript?: ScriptRunner;
  openDatabase?: (file: string) => ReturnType<typeof openChatDatabase>;
  permissions?: MacPermissions;
}): MacApps {
  const runScript = deps.runScript ?? osascript;
  const openDatabase = deps.openDatabase ?? openChatDatabase;
  const chatDb = path.join(deps.home, "Library", "Messages", "chat.db");

  function readMessages(
    call: Extract<MacAppCall, { tool: "mac_messages_chats" | "mac_messages_read" }>,
  ) {
    const access = fileAccessStatus(chatDatabaseAccess(chatDb));
    if (access === "denied") throw new MacAppError(FULL_DISK_ACCESS_MESSAGE);
    if (access === "unavailable") throw new MacAppError("Messages has no history on this Mac.");
    let db: ReturnType<typeof openChatDatabase>;
    try {
      db = openDatabase(chatDb);
    } catch {
      throw new MacAppError("Messages history could not be read on this Mac.");
    }
    try {
      if (call.tool === "mac_messages_chats") return { chats: listChats(db, call.args.limit) };
      const result = readChat(db, call.args);
      if (!result.chat) throw new MacAppError("That chat was not found in Messages.");
      return result;
    } catch (error) {
      if (error instanceof MacAppError) throw error;
      throw new MacAppError("Messages history could not be read on this Mac.");
    } finally {
      db.close();
    }
  }

  return {
    async run(call, signal) {
      if (call.tool === "mac_messages_chats" || call.tool === "mac_messages_read")
        return readMessages(call);
      let output: string;
      try {
        output = await runScript(
          MAC_TOOL_SCRIPTS[call.tool],
          [JSON.stringify(scriptArgs(call))],
          signal,
        );
      } catch (error) {
        const failure = macAppFailure(call, error);
        if (automationErrorCode(error) === AE_NOT_PERMITTED)
          deps.permissions?.remember(macAppToolEntry(call.tool)!.tool.grants[0]!, "denied");
        throw failure;
      }
      try {
        return JSON.parse(output);
      } catch {
        throw new MacAppError(
          `${macAppToolEntry(call.tool)!.app.name} gave an answer RoBots could not read.`,
        );
      }
    },
  };
}

function settled(attempt: Promise<unknown>): Promise<"done" | "failed"> {
  return attempt.then(
    () => "done",
    () => "failed",
  );
}

export function createDesktopMacApps(deps: {
  home: string;
  openSettings: (url: string) => Promise<void>;
  automationCode: (bundleId: string) => number | null;
  runScript?: ScriptRunner;
}) {
  const runScript = deps.runScript ?? osascript;
  const chatDb = path.join(deps.home, "Library", "Messages", "chat.db");
  const permissions = createMacPermissions({
    automation: async (bundleId) => deps.automationCode(bundleId),
    promptAutomation: (bundleId) =>
      runScript(AUTOMATION_PROBE_SCRIPT, [bundleId], AbortSignal.timeout(PROMPT_TIMEOUT_MS)),
    location: async () =>
      JSON.parse(await runScript(LOCATION_STATUS_SCRIPT, [], AbortSignal.timeout(10_000))),
    promptLocation: () =>
      settled(
        runScript(
          MAC_TOOL_SCRIPTS.mac_location_current,
          [JSON.stringify({ timeoutMs: LOCATION_TIMEOUT_MS })],
          AbortSignal.timeout(PROMPT_TIMEOUT_MS),
        ),
      ),
    messagesDatabase: async () => chatDatabaseAccess(chatDb),
    openSettings: deps.openSettings,
  });
  return { permissions, macApps: createMacApps({ home: deps.home, runScript, permissions }) };
}
