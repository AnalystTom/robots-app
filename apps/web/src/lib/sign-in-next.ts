export const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export const SLACK_INSTALL_CALLBACK_PATH = "/messaging/slack/callback";

const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{1,200}$/;
const APP_PATH = /^\/app(?:\/[\w-]+)*\/?(?:\?[^#\s]*)?$/;

export function signInNext(next: string | null): string | null {
  if (!next) return null;
  if (
    next === "/integrations/setup" ||
    next === "/admin/plugins" ||
    next === "/admin/access" ||
    next.startsWith(`${MCP_OAUTH_CALLBACK_PATH}?`) ||
    next.startsWith(`${SLACK_INSTALL_CALLBACK_PATH}?`) ||
    INVITE_PATH.test(next) ||
    APP_PATH.test(next)
  ) {
    return next;
  }
  return null;
}

export function newAccountDestination(next: string | null): string {
  return next && INVITE_PATH.test(next) ? next : "/onboarding";
}
