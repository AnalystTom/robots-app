const AGENT_PRODUCT =
  "(?:Grok(?: Build| Bot| CLI)?|Claude(?: Code| Desktop)?|(?:OpenAI )?Codex(?: CLI)?|Cursor|(?:GitHub )?Copilot|Gemini CLI|Windsurf|ChatGPT|OpenCode)";
const AGENT_SUFFIX = "(?:'s)?(?:\\s+(?:agents?|users?|sessions?|IDE|editor|app|plugins?))?";
const HOST_ATTRIBUTION = new RegExp(
  `\\s+(?:directly\\s+)?(?:for|in|from|with|inside|within|via|using|to|into)\\s+(?:the\\s+)?${AGENT_PRODUCT}${AGENT_SUFFIX}(?![\\w-])`,
  "g",
);

export function pluginDisplayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function withoutHostAttribution(description: string): string {
  return description.replace(/\s+/g, " ").replace(HOST_ATTRIBUTION, "").trim();
}
