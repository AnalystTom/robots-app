const HOST_ASSISTANT = String.raw`[Gg]rok(?: Build| Bot| CLI)?\b(?!\s+[A-Z])`;
const HOST_DESTINATION = new RegExp(
  String.raw`\s+(?:directly\s+)?(?:for|in|from|inside|within)\s+${HOST_ASSISTANT}`,
  "g",
);
const HOST_MENTION = new RegExp(String.raw`\b${HOST_ASSISTANT}`, "g");
const NAMES_HOST = /(?:^|[^a-z])grok(?:[^a-z]|$)/i;

const startsSentence = (before: string) => /(?:^|[.!?])\s*$/.test(before);

export function neutralPluginDescription(description: string, pluginName: string): string {
  if (NAMES_HOST.test(pluginName)) return description;
  return description
    .replace(HOST_DESTINATION, "")
    .replace(HOST_MENTION, (_match, offset: number, text: string) =>
      startsSentence(text.slice(0, offset)) ? "Your bot" : "your bot",
    );
}
