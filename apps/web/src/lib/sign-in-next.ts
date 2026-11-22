export const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export const SLACK_INSTALL_CALLBACK_PATH = "/messaging/slack/callback";

const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{1,200}$/;
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATE_PATH = /^\/templates\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function templateImportPath(templateId: string): string {
  return `/templates/${templateId}`;
}

export function signInNext(params: URLSearchParams): string | null {
  const template = params.get("template");
  if (template && TEMPLATE_ID.test(template) && template.length <= 64) {
    return templateImportPath(template);
  }
  const next = params.get("next");
  if (!next) return null;
  if (
    next === "/integrations/setup" ||
    next === "/admin/plugins" ||
    next === "/admin/access" ||
    next.startsWith(`${MCP_OAUTH_CALLBACK_PATH}?`) ||
    next.startsWith(`${SLACK_INSTALL_CALLBACK_PATH}?`) ||
    INVITE_PATH.test(next) ||
    TEMPLATE_PATH.test(next)
  ) {
    return next;
  }
  return null;
}

export function newAccountDestination(next: string | null): string {
  if (next && INVITE_PATH.test(next)) return next;
  const template = next ? TEMPLATE_PATH.exec(next)?.[1] : undefined;
  return template ? `/onboarding?template=${template}` : "/onboarding";
}

export function onboardingTemplate(params: URLSearchParams): string | null {
  const template = params.get("template");
  return template && TEMPLATE_ID.test(template) && template.length <= 64 ? template : null;
}
