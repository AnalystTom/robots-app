import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotTemplateListing, ConnectionCatalogItem } from "@robots/contracts";
import { isBotTemplateChanged } from "@robots/contracts";
import { BOT_TEMPLATE_TEAMS, botTemplateAppMarks } from "@robots/core";
import { botTeamIncompleteError } from "@robots/i18n/bot-team";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@robots/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSave, useSpaceQueries } from "../../lib/query";
import { errorDetails } from "../../lib/user-error";
import { ErrorNotice } from "../ErrorNotice";
import { PluginLogo } from "../integrations/plugin-marketplace";
import { useBotTemplateCopy } from "./bot-template-copy";

type TemplatePick =
  | { kind: "bot"; template: BotTemplateListing }
  | { kind: "team"; teamId: string };

export function BotTemplatesDialog({
  onClose,
  onOpenBot,
}: {
  onClose: () => void;
  onOpenBot: (bot: Bot) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const copy = useBotTemplateCopy();
  const templates = useQuery({ ...queries.bots.templates.queryOptions(), staleTime: 0 });
  const catalog = useQuery(queries.connections.catalog.queryOptions({ input: {} }));
  const open = useSave({
    save: async (pick: TemplatePick, client): Promise<Bot> => {
      if (pick.kind === "team") {
        const { bots, failed } = await client.bots.createTeamFromTemplate({ teamId: pick.teamId });
        if (failed.length) {
          await Promise.allSettled(
            [queries.bots.templates.queryKey(), queries.bots.list.queryKey()].map((queryKey) =>
              queryClient.invalidateQueries({ queryKey }),
            ),
          );
          throw botTeamIncompleteError(bots.length, bots.length + failed.length);
        }
        return bots[0]!;
      }
      const { template } = pick;
      if (template.botId) return client.bots.get({ botId: template.botId });
      const { bot } = await client.bots.createFromTemplate({
        templateId: template.id,
        version: template.version,
        name: copy(template).name,
      });
      return bot;
    },
    stale: [queries.bots.templates.queryKey()],
    closesScreen: true,
    onSaved: onOpenBot,
    onFailed: (error) => {
      if (isBotTemplateChanged(error)) void templates.refetch();
    },
  });

  function content() {
    if (templates.error)
      return (
        <ErrorNotice error={errorDetails(templates.error, t`Could not load templates`)}>
          <Button variant="outline" size="sm" onClick={() => void templates.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </ErrorNotice>
      );
    if (!templates.data)
      return (
        <div className="grid place-items-center py-10">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      );
    return (
      <div className="space-y-4">
        {open.error ? (
          <ErrorNotice
            error={errorDetails(
              isBotTemplateChanged(open.error)
                ? t`This template was just updated. Try again.`
                : open.error,
              open.input?.kind === "bot" && open.input.template.botId
                ? t`Could not open the bot`
                : t`Could not create the bot`,
            )}
          >
            {open.input?.kind === "team" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={open.pending}
                onClick={() => open.run(open.input!)}
              >
                <Trans>Retry</Trans>
              </Button>
            ) : null}
          </ErrorNotice>
        ) : null}
        {BOT_TEMPLATE_TEAMS.map((team) => (
          <TeamCard
            key={team.id}
            crew={team.templateIds.flatMap(
              (id) => templates.data.find((template) => template.id === id) ?? [],
            )}
            busy={open.pending}
            creating={open.pending && open.input?.kind === "team"}
            onPick={() => open.run({ kind: "team", teamId: team.id })}
          />
        ))}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              copy={copy(template)}
              catalog={catalog.data ?? []}
              busy={open.pending}
              creating={
                open.pending && open.input?.kind === "bot" && open.input.template.id === template.id
              }
              onPick={() => open.run({ kind: "bot", template })}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="bot-templates-dialog"
        size="lg"
        className="bg-card"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <DialogTitle className="text-heading2 text-foreground">
            <Trans>RoBot templates</Trans>
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close RoBot templates`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-5 pb-8">{content()}</div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  copy,
  catalog,
  busy,
  creating,
  onPick,
}: {
  template: BotTemplateListing;
  copy: { name: string; summary: string };
  catalog: ConnectionCatalogItem[];
  busy: boolean;
  creating: boolean;
  onPick: () => void;
}) {
  const { t } = useLingui();
  const marks = botTemplateAppMarks(template, catalog);
  const { name, summary } = copy;
  return (
    <li
      data-testid="bot-template-card"
      aria-label={name}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/70 p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <BotAvatar color={template.avatar} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body-lg font-medium text-foreground">{name}</h3>
          <p className="text-body-sm text-muted-foreground">{summary}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <ul aria-label={t`Works with`} className="flex min-w-0 flex-1 items-center gap-1.5">
          {marks.map((mark) => (
            <li key={mark.key} title={mark.name} aria-label={mark.name}>
              <PluginLogo name={mark.name} logo={mark.logo} site={mark.site} size="small" />
            </li>
          ))}
        </ul>
        {template.botId ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label={t`Open ${name}`}
            onClick={onPick}
          >
            <Trans>Open</Trans>
          </Button>
        ) : (
          <Button size="sm" disabled={busy} aria-label={t`Create ${name}`} onClick={onPick}>
            {creating ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
          </Button>
        )}
      </div>
    </li>
  );
}

function TeamCard({
  crew,
  busy,
  creating,
  onPick,
}: {
  crew: BotTemplateListing[];
  busy: boolean;
  creating: boolean;
  onPick: () => void;
}) {
  const { t } = useLingui();
  const copy = useBotTemplateCopy();
  const name = t`Autopilot team`;
  const [lead, ...others] = crew.map((member) => copy(member).name);
  const otherNames = others.join(", ");
  return (
    <section
      data-testid="bot-template-team"
      aria-label={name}
      className="flex min-w-0 flex-wrap items-center gap-4 rounded-2xl border border-border/70 p-4"
    >
      <div className="flex shrink-0 -space-x-3">
        {crew.map((member) => (
          <BotAvatar key={member.id} color={member.avatar} size={40} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-body-lg font-medium text-foreground">{name}</h3>
        <p className="text-body-sm text-muted-foreground">{t`${lead} runs ${otherNames}.`}</p>
      </div>
      <Button size="sm" disabled={busy} aria-label={t`Create ${name}`} onClick={onPick}>
        {creating ? <Trans>Creating…</Trans> : <Trans>Create team</Trans>}
      </Button>
    </section>
  );
}
