import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotTemplateListing, ConnectionCatalogItem } from "@robots/contracts";
import { isBotTemplateChanged } from "@robots/contracts";
import { botTemplateAppMarks } from "@robots/core";
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
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSave, useSpaceQueries } from "../../lib/query";
import { errorDetails } from "../../lib/user-error";
import { ErrorNotice } from "../ErrorNotice";
import { PluginLogo } from "../integrations/plugin-marketplace";
import { useBotTemplateCopy } from "./bot-template-copy";

export function BotTemplatesDialog({
  onClose,
  onOpenBot,
}: {
  onClose: () => void;
  onOpenBot: (bot: Bot) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const copy = useBotTemplateCopy();
  const templates = useQuery({ ...queries.bots.templates.queryOptions(), staleTime: 0 });
  const catalog = useQuery(queries.connections.catalog.queryOptions({ input: {} }));
  const open = useSave({
    save: async ({ template }: { template: BotTemplateListing }, client) =>
      template.botId
        ? client.bots.get({ botId: template.botId })
        : (
            await client.bots.createFromTemplate({
              templateId: template.id,
              version: template.version,
              name: copy(template).name,
            })
          ).bot,
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
              open.input?.template.botId ? t`Could not open the bot` : t`Could not create the bot`,
            )}
          />
        ) : null}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              copy={copy(template)}
              catalog={catalog.data ?? []}
              busy={open.pending}
              creating={open.pending && open.input?.template.id === template.id}
              onPick={() => open.run({ template })}
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
