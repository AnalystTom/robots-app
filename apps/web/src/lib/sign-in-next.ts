export const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export const SLACK_INSTALL_CALLBACK_PATH = "/messaging/slack/callback";

const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{1,200}$/;
const APP_PATH = /^\/app(?:\/[\w-]+)*\/?(?:\?[^#\s]*)?$/;
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATE_PATH = /^\/templates\/([^/]+)$/;

export function templateImportPath(templateId: string): string {
  return `/templates/${templateId}`;
}

function templateSlug(value: string | null | undefined): string | null {
  return value && value.length <= 64 && TEMPLATE_ID.test(value) ? value : null;
}

function templateSlugFromPath(path: string): string | null {
  return templateSlug(TEMPLATE_PATH.exec(path)?.[1]);
}

export function signInNext(params: URLSearchParams): string | null {
  const template = templateSlug(params.get("template"));
  if (template) return templateImportPath(template);
  const next = params.get("next");
  if (!next) return null;
  if (
    next === "/integrations/setup" ||
    next === "/admin/plugins" ||
    next === "/admin/access" ||
    next.startsWith(`${MCP_OAUTH_CALLBACK_PATH}?`) ||
    next.startsWith(`${SLACK_INSTALL_CALLBACK_PATH}?`) ||
    INVITE_PATH.test(next) ||
    APP_PATH.test(next) ||
    templateSlugFromPath(next) !== null
  ) {
    return next;
  }
  return null;
}

export function newAccountDestination(next: string | null): string {
  if (next && INVITE_PATH.test(next)) return next;
  const template = next ? templateSlugFromPath(next) : null;
  return template ? `/onboarding?template=${template}` : "/onboarding";
}

export function onboardingTemplate(params: URLSearchParams): string | null {
  return templateSlug(params.get("template"));
}
