import { recommendedPluginDescription } from "@robots/core";

const AGENT_PRODUCT =
  "(?:Grok(?: Build| Bot| CLI)?|Claude(?: Code| Desktop)?|(?:OpenAI )?Codex(?: CLI)?|Cursor|(?:GitHub )?Copilot|Gemini CLI|Windsurf|ChatGPT|OpenCode)";
const AGENT_SUFFIX = "(?:'s)?(?:\\s+(?:agents?|users?|sessions?|IDE|editor|app|plugins?))?";
const HOST_ATTRIBUTION = new RegExp(
  `\\s+(?:directly\\s+)?(?:for|in|from|with|inside|within|via|using|to|into)\\s+(?:the\\s+)?${AGENT_PRODUCT}${AGENT_SUFFIX}(?=\\s*(?:[.,;:!?)]|$))`,
  "g",
);
const MIN_WORDS = 3;
const NAMES_AGENT_PRODUCT = new RegExp(`(?<![\\w-])${AGENT_PRODUCT}(?![\\w-])`);

export function namesAgentProduct(text: string): boolean {
  return NAMES_AGENT_PRODUCT.test(text);
}

export function pluginDisplayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function robotsPluginDescription(description: string, pluginName: string): string {
  const curated = recommendedPluginDescription(pluginName);
  if (curated) return curated;
  const trimmed = description.replace(/\s+/g, " ").trim();
  const neutral = trimmed.replace(HOST_ATTRIBUTION, "").trim();
  const tooShort = neutral !== trimmed && neutral.split(" ").length < MIN_WORDS;
  if (neutral && !tooShort && !namesAgentProduct(neutral)) return neutral;
  return `Work with ${pluginDisplayName(pluginName)} from your RoBot.`;
}
