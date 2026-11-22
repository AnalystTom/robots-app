import { findBotTemplate, findBotTemplateTeam } from "@robots/core";
import { createBotTeam } from "@robots/i18n/bot-team";
import type { SpaceQueries } from "./query";
import { queryClient } from "./query";
import { rpc } from "./rpc";

export const TEMPLATE_GALLERY_PATH = "/app?templates";

export function isBotTemplateLink(templateId: string): boolean {
  return Boolean(findBotTemplateTeam(templateId) ?? findBotTemplate(templateId));
}

export function refreshBotReads(queries: SpaceQueries) {
  return Promise.allSettled(
    [queries.bots.templates.queryKey(), queries.bots.list.queryKey()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export async function importBotTemplate(
  templateId: string,
  queries: SpaceQueries,
): Promise<string | null> {
  if (findBotTemplateTeam(templateId)) {
    const [lead] = await createBotTeam(
      () => rpc.bots.createTeamFromTemplate({ teamId: templateId }),
      () => refreshBotReads(queries),
    );
    return lead!.id;
  }
  const templates = await rpc.bots.templates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  if (template.botId) return template.botId;
  const { bot } = await rpc.bots.createFromTemplate({
    templateId: template.id,
    version: template.version,
  });
  return bot.id;
}
