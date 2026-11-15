import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, Doc } from "@robots/contracts";
import { docTitle } from "@robots/contracts";
import { Button, Disclosure, ListSearchInput, SectionHeading } from "@robots/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { followStream } from "../../lib/follow-stream";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { spaceChanged } from "../../lib/space-changes";
import { errorText } from "../../lib/user-error";
import { DocReader, NewDoc } from "./doc-reader";
import { WorkspaceLayout } from "./WorkspaceLayout";

const NO_DOCS: Doc[] = [];
const NO_BOTS: Bot[] = [];

/**
 * The Space's shared docs (the shared memory every bot reads and writes) beside a reader. Each
 * bot's own notes sit under Background files. On a phone the list and the reader take turns.
 */
export function DocsPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const docsQuery = useQuery(queries.docs.list.queryOptions());
  const botsQuery = useQuery(queries.bots.list.queryOptions());
  const docs = docsQuery.data ?? NO_DOCS;
  const bots = botsQuery.data ?? NO_BOTS;
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [search, setSearch] = useState("");

  // Bots edit docs as they work; re-read when the Space says memory changed.
  useEffect(
    () =>
      followStream(
        (signal) => rpc.notifications.subscribe(undefined, { signal }),
        (frame) => {
          if (frame.type === "memory") void spaceChanged("memory", queryClient);
        },
      ),
    [queryClient],
  );

  const botName = (botId: string | null) =>
    botId ? (bots.find((bot) => bot.id === botId)?.name ?? null) : null;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return docs;
    return docs.filter(
      (doc) =>
        doc.path.toLowerCase().includes(needle) || doc.content.toLowerCase().includes(needle),
    );
  }, [docs, search]);
  const shared = filtered.filter((doc) => doc.scope === "user");
  const background = bots
    .map((bot) => ({
      bot,
      docs: filtered.filter((doc) => doc.scope === "bot" && doc.botId === bot.id),
    }))
    .filter((group) => group.docs.length > 0);
  const open = selected && selected !== "new" ? docs.find((doc) => doc.id === selected) : null;
  // A doc deleted elsewhere closes instead of showing stale content.
  const showing = selected === "new" || Boolean(open);
  const loadError = docsQuery.error ?? botsQuery.error;

  const row = (doc: Doc) => {
    const editor = botName(doc.editedByBotId);
    const when = formatRelativeTime(doc.updatedAt);
    return (
      <li key={doc.id}>
        <button
          type="button"
          data-testid={`doc-row-${doc.id}`}
          aria-current={doc.id === selected ? "true" : undefined}
          onClick={() => setSelected(doc.id)}
          className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start hover:bg-muted ${
            doc.id === selected ? "bg-muted" : ""
          }`}
        >
          <span className="w-full truncate text-body">{docTitle(doc.path)}</span>
          <span className="w-full truncate text-label text-muted-foreground">
            {editor ? t`${when} by ${editor}` : when}
          </span>
        </button>
      </li>
    );
  };

  return (
    <WorkspaceLayout
      page="docs"
      title={<Trans>Docs</Trans>}
      actions={
        <Button size="sm" onClick={() => setSelected("new")} data-testid="docs-new">
          <Trans>New doc</Trans>
        </Button>
      }
    >
      <div className="flex h-full min-h-0">
        <aside
          className={`${showing ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col gap-3 overflow-auto border-e p-3 md:w-72`}
          data-testid="docs-library"
        >
          <ListSearchInput
            query={search}
            setQuery={setSearch}
            label={t`Search docs`}
            placeholder={t`Search`}
          />
          {loadError ? (
            <p role="alert" className="px-1 text-body text-destructive">
              {errorText(loadError)}
            </p>
          ) : null}
          {shared.length > 0 ? (
            <ul className="flex flex-col gap-0.5">{shared.map(row)}</ul>
          ) : docsQuery.isSuccess ? (
            <p className="px-1 text-body text-muted-foreground">
              {search.trim() ? <Trans>No matches</Trans> : <Trans>No docs yet</Trans>}
            </p>
          ) : null}
          {background.length > 0 ? (
            <Disclosure
              summary={
                <SectionHeading as="h2" variant="label">
                  <Trans>Background files</Trans>
                </SectionHeading>
              }
              summaryClassName="px-1"
              contentClassName="flex flex-col gap-2 pt-2"
            >
              {background.map((group) => (
                <section key={group.bot.id} aria-label={group.bot.name}>
                  <SectionHeading as="h3" variant="label" className="px-2.5 pb-0.5">
                    {group.bot.name}
                  </SectionHeading>
                  <ul className="flex flex-col gap-0.5">{group.docs.map(row)}</ul>
                </section>
              ))}
            </Disclosure>
          ) : null}
        </aside>
        <section
          className={`${showing ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}
          data-testid="docs-reader"
        >
          {selected === "new" ? (
            <NewDoc onClose={() => setSelected(null)} onCreated={(doc) => setSelected(doc.id)} />
          ) : open ? (
            <DocReader
              key={open.id}
              doc={open}
              bots={bots}
              botName={botName}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="m-auto text-body text-muted-foreground">
              <Trans>Pick a doc to read</Trans>
            </p>
          )}
        </section>
      </div>
    </WorkspaceLayout>
  );
}
