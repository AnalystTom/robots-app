import type { AppBootstrap } from "@robots/contracts";

export function initialBootstrapTarget(path: string, desktop: boolean) {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const appRoute = pathname === "/app" || pathname.startsWith("/app/");
  if (!appRoute && !(desktop && pathname === "/")) return null;
  return {
    botId: appRoute ? botIdFromPath(pathname) : undefined,
    groupId: appRoute ? groupIdFromPath(pathname) : undefined,
  };
}

function botIdFromPath(pathname: string) {
  const segments = pathname.split("/");
  if (
    ["g", "artifacts", "board", "tasks", "today", "email", "docs", "x"].includes(segments[2] ?? "")
  )
    return undefined;
  return decoded(segments[2]);
}

function groupIdFromPath(pathname: string) {
  const segments = pathname.split("/");
  return segments[2] === "g" ? decoded(segments[3]) : undefined;
}

function decoded(segment: string | undefined) {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function linkedBotRoute(
  bootstrap: Pick<AppBootstrap, "botSpaceId" | "bots" | "me">,
  botId: string | undefined,
  search: string,
): { spaceId: string; path: string } | undefined {
  if (!botId || !bootstrap.botSpaceId || bootstrap.botSpaceId === bootstrap.me.spaceId)
    return undefined;
  if (bootstrap.bots.some((bot) => bot.id === botId)) return undefined;
  return { spaceId: bootstrap.botSpaceId, path: `/app/${encodeURIComponent(botId)}${search}` };
}

export function linkedGroupRoute(
  bootstrap: Pick<AppBootstrap, "groupSpaceId" | "groups" | "me">,
  groupId: string | undefined,
  search: string,
): { spaceId: string; path: string } | undefined {
  if (!groupId || !bootstrap.groupSpaceId || bootstrap.groupSpaceId === bootstrap.me.spaceId)
    return undefined;
  if (bootstrap.groups.some((group) => group.id === groupId)) return undefined;
  return {
    spaceId: bootstrap.groupSpaceId,
    path: `/app/g/${encodeURIComponent(groupId)}${search}`,
  };
}
