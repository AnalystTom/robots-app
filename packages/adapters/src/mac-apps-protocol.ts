import type { MacAppToolName } from "@robots/contracts";
import { MAC_APP_TOOL_NAMES } from "@robots/contracts";
import { z } from "zod";
import type { MacAppToolArgs } from "./mac-apps.tool-definition.js";
import { MAC_APP_TOOL_ARGS } from "./mac-apps.tool-definition.js";

export type MacAppCall = {
  [K in MacAppToolName]: { tool: K; args: MacAppToolArgs[K] };
}[MacAppToolName];

const [first, ...rest] = MAC_APP_TOOL_NAMES.map((tool) =>
  z.object({ tool: z.literal(tool), args: MAC_APP_TOOL_ARGS[tool] }),
);

export const macAppCall = z.discriminatedUnion("tool", [first!, ...rest]) as unknown as z.ZodType<
  MacAppCall,
  { tool: string; args: unknown }
>;

export function parseMacAppCall(
  tool: string,
  args: unknown,
): { call: MacAppCall } | { error: string } {
  const parsed = macAppCall.safeParse({ tool, args });
  if (parsed.success) return { call: parsed.data };
  const issue = parsed.error.issues[0];
  const at = issue?.path.filter((part) => part !== "args").join(".");
  return { error: `${at ? `${at}: ` : ""}${issue?.message ?? "invalid arguments"}` };
}

export interface MacApps {
  run(call: MacAppCall, signal: AbortSignal): Promise<unknown>;
}

export class MacAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacAppError";
  }
}

export const MAC_APPS_UNAVAILABLE_MESSAGE = "Mac apps are not available on this computer.";
