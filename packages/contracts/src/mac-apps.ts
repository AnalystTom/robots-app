export const MAC_APP_IDS = [
  "mail",
  "messages",
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "location",
] as const;
export type MacAppId = (typeof MAC_APP_IDS)[number];

export const MAC_GRANT_IDS = [
  "automation-mail",
  "automation-messages",
  "automation-notes",
  "automation-reminders",
  "automation-calendar",
  "automation-contacts",
  "full-disk-access",
  "location",
] as const;
export type MacGrantId = (typeof MAC_GRANT_IDS)[number];

export function isMacGrantId(value: unknown): value is MacGrantId {
  return (MAC_GRANT_IDS as readonly unknown[]).includes(value);
}

export type MacGrantStatus = "granted" | "denied" | "not-determined" | "unavailable";

export interface MacGrantState {
  grant: MacGrantId;
  status: MacGrantStatus;
}

export interface MacGrant {
  id: MacGrantId;
  label: string;
  pane: "Automation" | "Full Disk Access" | "Location Services";
  settingsUrl: string;
  allow: "prompt" | "settings";
}

const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_";

function automation(id: MacGrantId, app: string): MacGrant {
  return {
    id,
    label: `Control ${app}`,
    pane: "Automation",
    settingsUrl: `${PRIVACY_PANE}Automation`,
    allow: "prompt",
  };
}

export const MAC_GRANTS: Readonly<Record<MacGrantId, MacGrant>> = {
  "automation-mail": automation("automation-mail", "Mail"),
  "automation-messages": automation("automation-messages", "Messages"),
  "automation-notes": automation("automation-notes", "Notes"),
  "automation-reminders": automation("automation-reminders", "Reminders"),
  "automation-calendar": automation("automation-calendar", "Calendar"),
  "automation-contacts": automation("automation-contacts", "Contacts"),
  "full-disk-access": {
    id: "full-disk-access",
    label: "Read your message history",
    pane: "Full Disk Access",
    settingsUrl: `${PRIVACY_PANE}AllFiles`,
    allow: "settings",
  },
  location: {
    id: "location",
    label: "See your location",
    pane: "Location Services",
    settingsUrl: `${PRIVACY_PANE}LocationServices`,
    allow: "prompt",
  },
};

export type MacToolKind = "read" | "change" | "send";
export type MacToolSetting = "allowed" | "ask" | "off";
export type MacToolDefault = "asks-once-per-app" | "asks-every-time";

export interface MacAppTool {
  name: string;
  label: string;
  kind: MacToolKind;
  byDefault: MacToolDefault;
  settings: readonly MacToolSetting[];
  grants: readonly MacGrantId[];
}

export interface MacAppConnection {
  id: MacAppId;
  connectorKind: string;
  name: string;
  icon: string;
  description: string;
  runsOn: "this-mac";
  availability: string;
  grants: readonly MacGrantId[];
  tools: readonly MacAppTool[];
}

export const MAC_APP_AVAILABILITY = "Works while it's online";

const ANY_SETTING: readonly MacToolSetting[] = ["allowed", "ask", "off"];
const NEVER_ALLOWED: readonly MacToolSetting[] = ["ask", "off"];

function tool(
  name: string,
  label: string,
  kind: MacToolKind,
  grants: readonly MacGrantId[],
  byDefault: MacToolDefault = kind === "send" ? "asks-every-time" : "asks-once-per-app",
): MacAppTool {
  return {
    name,
    label,
    kind,
    byDefault,
    settings: kind === "send" ? NEVER_ALLOWED : ANY_SETTING,
    grants,
  };
}

function connection(
  id: MacAppId,
  name: string,
  icon: string,
  description: string,
  tools: readonly MacAppTool[],
): MacAppConnection {
  return {
    id,
    connectorKind: `mac_${id}`,
    name,
    icon,
    description,
    runsOn: "this-mac",
    availability: MAC_APP_AVAILABILITY,
    grants: [...new Set(tools.flatMap((entry) => entry.grants))],
    tools,
  };
}

const MAIL: readonly MacGrantId[] = ["automation-mail"];
const NOTES: readonly MacGrantId[] = ["automation-notes"];
const REMINDERS: readonly MacGrantId[] = ["automation-reminders"];
const CALENDAR: readonly MacGrantId[] = ["automation-calendar"];
const CONTACTS: readonly MacGrantId[] = ["automation-contacts"];

export const MAC_APP_CONNECTIONS: readonly MacAppConnection[] = [
  connection("mail", "Mail", "mail", "Search, read and draft email in Mail on your Mac.", [
    tool("mac_mail_search", "Search your email", "read", MAIL),
    tool("mac_mail_read", "Read an email", "read", MAIL),
    tool("mac_mail_draft", "Write a draft", "change", MAIL),
    tool("mac_mail_send", "Send an email", "send", MAIL),
  ]),
  connection(
    "messages",
    "Messages",
    "message-circle",
    "Read your chats and send messages from your Mac.",
    [
      tool("mac_messages_chats", "See your recent chats", "read", ["full-disk-access"]),
      tool("mac_messages_read", "Read a chat", "read", ["full-disk-access"]),
      tool("mac_messages_send", "Send a message", "send", ["automation-messages"]),
    ],
  ),
  connection("notes", "Notes", "notebook", "Find, read and write notes on your Mac.", [
    tool("mac_notes_search", "Search your notes", "read", NOTES),
    tool("mac_notes_read", "Read a note", "read", NOTES),
    tool("mac_notes_create", "Create a note", "change", NOTES),
    tool("mac_notes_append", "Add to a note", "change", NOTES),
  ]),
  connection("reminders", "Reminders", "list-checks", "See, add and complete reminders.", [
    tool("mac_reminders_list", "See your reminders", "read", REMINDERS),
    tool("mac_reminders_create", "Add a reminder", "change", REMINDERS),
    tool("mac_reminders_complete", "Complete a reminder", "change", REMINDERS),
  ]),
  connection("calendar", "Calendar", "calendar", "See your events and add new ones.", [
    tool("mac_calendar_events", "See your events", "read", CALENDAR),
    tool("mac_calendar_create_event", "Add an event", "change", CALENDAR, "asks-every-time"),
  ]),
  connection("contacts", "Contacts", "contact", "Look up people in your contacts.", [
    tool("mac_contacts_search", "Search your contacts", "read", CONTACTS),
    tool("mac_contacts_read", "Read a contact", "read", CONTACTS),
  ]),
  connection("location", "Location", "map-pin", "Share where your Mac is right now.", [
    tool(
      "mac_location_current",
      "Get your current location",
      "read",
      ["location"],
      "asks-every-time",
    ),
  ]),
];

export const MAC_APP_TOOL_NAMES = [
  "mac_mail_search",
  "mac_mail_read",
  "mac_mail_draft",
  "mac_mail_send",
  "mac_messages_chats",
  "mac_messages_read",
  "mac_messages_send",
  "mac_notes_search",
  "mac_notes_read",
  "mac_notes_create",
  "mac_notes_append",
  "mac_reminders_list",
  "mac_reminders_create",
  "mac_reminders_complete",
  "mac_calendar_events",
  "mac_calendar_create_event",
  "mac_contacts_search",
  "mac_contacts_read",
  "mac_location_current",
] as const;
export type MacAppToolName = (typeof MAC_APP_TOOL_NAMES)[number];

const TOOL_INDEX = new Map(
  MAC_APP_CONNECTIONS.flatMap((app) =>
    app.tools.map((entry) => [entry.name, { app, tool: entry }]),
  ),
);

export function macAppToolEntry(
  name: string,
): { app: MacAppConnection; tool: MacAppTool } | undefined {
  return TOOL_INDEX.get(name);
}

export function isMacAppTool(name: string): name is MacAppToolName {
  return TOOL_INDEX.has(name);
}
