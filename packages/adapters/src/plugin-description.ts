const HOST_ATTRIBUTION =
  /\s+(?:directly\s+)?(?:for|in|from)\s+[Gg]rok(?: Build| Bot| CLI)?(?=\s*(?:[.,;:!?]|$))/g;
const NAMES_HOST = /(?:^|[^a-z])grok(?:[^a-z]|$)/i;

export function neutralPluginDescription(description: string, pluginName: string): string {
  if (NAMES_HOST.test(pluginName)) return description;
  return description.replace(HOST_ATTRIBUTION, "");
}
