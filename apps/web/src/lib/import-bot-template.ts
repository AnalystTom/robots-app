import { findBotTemplate, findBotTemplateTeam } from "@robots/core";
import { rpc } from "./rpc";

export const TEMPLATE_GALLERY_PATH = "/app?templates";

export function isBotTemplateLink(templateId: string): boolean {
  return Boolean(findBotTemplateTeam(templateId) ?? findBotTemplate(templateId));
}

export async function importBotTemplate(templateId: string): Promise<string | null> {
  if (findBotTemplateTeam(templateId)) {
    const { bots } = await rpc.bots.createTeamFromTemplate({ teamId: templateId });
    return bots[0]!.id;
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
