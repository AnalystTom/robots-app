import type { AgentImportSource } from "@robots/contracts";

export const AGENT_IMPORT_SOURCE_NAMES = {
  grok_bot: "Grok Bot",
} as const satisfies Partial<Record<AgentImportSource, string>>;
