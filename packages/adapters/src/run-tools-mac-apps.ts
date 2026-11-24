import type { AgentToolExecutionResult } from "@robots/adapter-kit";
import { MAC_APP_CONNECTIONS, macAppToolEntry } from "@robots/contracts";
import type { ActionApprovalSource } from "@robots/core";
import { redactSecrets } from "@robots/core";
import type { MacAppCall } from "./mac-apps-protocol.js";
import { parseMacAppCall } from "./mac-apps-protocol.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { connectedUserComputer, lastValue } from "./run-tools-user-computer.js";

export const MAC_APP_OFFLINE_MESSAGE =
  'The user\'s Mac is not connected. Their Mac apps work while the RoBots app is open on their Mac with "Let bots use this computer" turned on. Ask them to open it, then try again.';

const APPROVED_STATUSES = ["approved", "executing", "completed", "uncertain"];

const ONCE_PER_APP_TOOLS = new Map(
  MAC_APP_CONNECTIONS.map((app) => [
    app.id,
    app.tools.filter((tool) => tool.byDefault === "asks-once-per-app").map((tool) => tool.name),
  ]),
);

export function macAppConnectorKind(name: string): string | undefined {
  return macAppToolEntry(name)?.app.connectorKind;
}

export type MacAppGate = { plan: "allow" | "ask" | "deny"; everyTime: boolean };

export async function macAppGate(
  ctx: RunContext,
  name: string,
  verdict: {
    blocked: boolean;
    actionRule: "allow" | "ask" | "deny" | undefined;
    listSource: ActionApprovalSource;
  },
): Promise<MacAppGate> {
  const entry = macAppToolEntry(name);
  if (!entry || verdict.blocked || verdict.actionRule === "deny")
    return { plan: "deny", everyTime: true };
  const ask = { plan: "ask", everyTime: true } as const;
  if (entry.tool.kind === "send") return ask;
  if (verdict.actionRule === "ask" || verdict.listSource === "require_approval") return ask;
  if (verdict.actionRule === "allow" || verdict.listSource === "always_allow")
    return { plan: "allow", everyTime: false };
  if (entry.tool.byDefault === "asks-every-time") return ask;
  const { deps, run } = ctx;
  const pairedSince = await deps.userDevices?.pairedSince(run.userId);
  if (!pairedSince) return { plan: "ask", everyTime: false };
  const allowed = await deps.prisma.externalEffect.findFirst({
    where: {
      spaceId: run.spaceId,
      status: { in: APPROVED_STATUSES },
      createdAt: { gte: pairedSince },
      run: { userId: run.userId },
      kind: { in: ONCE_PER_APP_TOOLS.get(entry.app.id) ?? [] },
    },
    select: { id: true },
  });
  return { plan: allowed ? "allow" : "ask", everyTime: false };
}

export async function macAppTool(ctx: RunContext, call: ToolCall) {
  const parsed = parseMacAppCall(call.name, call.args);
  if ("error" in parsed) return call.finish({ error: parsed.error });
  const connected = await connectedUserComputer(ctx);
  if (connected?.platform !== "darwin") return call.finish({ error: MAC_APP_OFFLINE_MESSAGE });
  const { owner, devices, deviceId } = connected;
  const { signal } = ctx.context;
  try {
    const value = await lastValue(
      devices.request<unknown>(
        owner,
        { method: "macApp", botId: ctx.bot.id, runId: ctx.runId, call: parsed.call },
        signal,
        deviceId,
      ),
    );
    return call.finish(macAppToolResult(ctx, parsed.call, value));
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = redactSecrets(
      error instanceof Error ? error.message : "the Mac app did not answer",
      ctx.secrets,
    );
    return call.finish({ error: `The user's Mac did not finish: ${reason}` });
  }
}

function macAppToolResult(
  ctx: RunContext,
  call: MacAppCall,
  value: unknown,
): AgentToolExecutionResult {
  const entry = macAppToolEntry(call.tool)!;
  return {
    kind: "agent_tool_result",
    content: [{ type: "text", text: redactSecrets(JSON.stringify(value ?? null), ctx.secrets) }],
    details: { app: entry.app.name, done: entry.tool.label },
  };
}
