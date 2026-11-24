import type { MessageBlock } from "@robots/contracts";
import { macAppToolEntry } from "@robots/contracts";
import { CARD_TITLE_ESCAPED_CHARACTERS, redactSecrets } from "@robots/core";

const DETAIL_LIMIT = 4_000;

function title(value: unknown): string {
  return String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(new RegExp(CARD_TITLE_ESCAPED_CHARACTERS, "g"), "\\$&");
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}

function lines(entries: Array<[string, unknown]>): string[] {
  return entries.flatMap(([label, value]) => {
    const shown = Array.isArray(value) ? list(value) : String(value ?? "").trim();
    return shown ? [`${label}: ${shown}`] : [];
  });
}

function prompt(name: string, args: Record<string, unknown>): { text: string; detail: string[] } {
  const entry = macAppToolEntry(name)!;
  switch (name) {
    case "mac_mail_send":
      return {
        text: "Send this email from Mail on your Mac?",
        detail: [
          ...lines([
            ["To", args.to],
            ["Cc", args.cc],
            ["Bcc", args.bcc],
            ["Subject", args.subject],
          ]),
          "",
          String(args.body ?? ""),
        ],
      };
    case "mac_messages_send":
      return {
        text: "Send this message from Messages on your Mac?",
        detail: [
          ...lines([
            ["To", args.to],
            ["Chat", args.chat_guid],
          ]),
          "",
          String(args.text ?? ""),
        ],
      };
    case "mac_calendar_create_event":
      return {
        text: `Add “${title(args.title)}” to Calendar on your Mac?`,
        detail: lines([
          ["Starts", args.start],
          ["Ends", args.end],
          ["All day", args.all_day === true ? "yes" : ""],
          ["Calendar", args.calendar],
          ["Location", args.location],
          ["Notes", args.notes],
        ]),
      };
    case "mac_location_current":
      return { text: "Share your Mac's location?", detail: [] };
    default:
      return {
        text: `Use ${entry.app.name} on your Mac?`,
        detail: [
          entry.tool.label,
          ...lines([
            ["Search", args.query],
            ["Title", args.title],
            ["List", args.list],
            ["Folder", args.folder],
            ["From", args.from],
            ["To", args.to],
          ]),
        ],
      };
  }
}

export function macAppApprovalCard(
  effectId: string,
  name: string,
  args: Record<string, unknown>,
  secrets: string[],
  everyTime: boolean,
): MessageBlock {
  const { text, detail } = prompt(name, args);
  const shown = redactSecrets(detail.join("\n").trim(), secrets);
  return {
    kind: "ask",
    approvalEffectId: effectId,
    text: redactSecrets(text, secrets),
    ...(shown
      ? {
          detail: shown.length > DETAIL_LIMIT ? `${shown.slice(0, DETAIL_LIMIT - 1)}…` : shown,
          detailFormat: "text" as const,
        }
      : {}),
    status: "pending",
    actions: everyTime
      ? [
          { id: "allow", label: "Allow once" },
          { id: "deny", label: "Deny" },
        ]
      : [
          { id: "allow", label: "Allow in this space" },
          { id: "deny", label: "Deny" },
        ],
  };
}
