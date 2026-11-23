import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { ChatMarkdown } from "@robots/chat-ui/web";
import type { Bot, Doc, DocRevision } from "@robots/contracts";
import { docTitle, isDeletableMemoryDocument } from "@robots/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from "@robots/ui-web";
import { skipToken, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { appendComposerDraftText, composerDraftKey } from "../../lib/composer-draft";
import { useSave, useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { errorText } from "../../lib/user-error";

const isConflict = (error: unknown) => error instanceof ORPCError && error.code === "CONFLICT";

function useDocReads() {
  const queries = useSpaceQueries();
  return [queries.docs.key(), queries.memory.list.key()];
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="md:hidden"
      aria-label={t`Back to docs`}
      onClick={onClick}
    >
      <ChevronLeft aria-hidden="true" />
    </Button>
  );
}

/** One doc: rendered Markdown, or a plain editor saved against the revision it started from. */
export function DocReader({
  doc,
  bots,
  botName,
  onClose,
}: {
  doc: Doc;
  bots: readonly Bot[];
  botName: (botId: string | null) => string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const stale = useDocReads();
  const [draft, setDraft] = useState<{ content: string; baseRevision: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<DocRevision | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const title = docTitle(doc.path);

  const save = useSave({
    save: (next: { content: string; baseRevision: number }, rpc) =>
      rpc.memory.update({
        documentId: doc.id,
        content: next.content,
        expectedRevision: next.baseRevision,
      }),
    stale,
    onSaved: () => {
      setDraft(null);
      setViewing(null);
    },
  });
  const remove = useSave({
    save: (_: undefined, rpc) => rpc.memory.remove({ documentId: doc.id }),
    stale,
    onSaved: onClose,
    closesScreen: true,
  });
  const revisions = useQuery(
    historyOpen
      ? queries.docs.revisions.queryOptions({ input: { documentId: doc.id } })
      : {
          queryKey: queries.docs.revisions.queryKey({ input: { documentId: doc.id } }),
          queryFn: skipToken,
        },
  );

  const edit = (content: string) => {
    save.reset();
    setDraft({ content, baseRevision: draft?.baseRevision ?? doc.revision });
  };
  const askBot = (bot: Bot) => {
    appendComposerDraftText(
      composerDraftKey({ botId: bot.id }),
      t`Please update the doc ${doc.path}: `,
    );
    navigate(`/app/${bot.id}`);
  };
  const editor = botName(doc.editedByBotId);
  const when = formatRelativeTime(doc.updatedAt);
  const changedMeanwhile = draft !== null && doc.revision !== draft.baseRevision;
  const saveError = save.error
    ? isConflict(save.error)
      ? t`This doc changed while you were editing. Copy your changes, then discard to see the latest.`
      : errorText(save.error)
    : null;

  return (
    <article className="flex min-h-0 flex-1 flex-col" data-testid="doc-reader">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <BackButton onClick={onClose} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{title}</h2>
          <p className="truncate text-label text-muted-foreground">
            {editor ? t`Edited ${when} by ${editor}` : t`Edited ${when}`}
          </p>
        </div>
        {draft ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                save.reset();
                setDraft(null);
              }}
              disabled={save.pending}
            >
              <Trans>Discard</Trans>
            </Button>
            <Button
              size="sm"
              onClick={() => save.run(draft)}
              disabled={save.pending || draft.content === doc.content}
            >
              <Trans>Save</Trans>
            </Button>
          </>
        ) : (
          <>
            {bots.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                  <Trans>Ask a bot</Trans>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-44">
                  {bots.map((bot) => (
                    <DropdownMenuItem key={bot.id} onClick={() => askBot(bot)}>
                      {bot.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={historyOpen}
              onClick={() => {
                setHistoryOpen((open) => !open);
                setViewing(null);
              }}
            >
              <Trans>History</Trans>
            </Button>
            {isDeletableMemoryDocument(doc.path) ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
                <Trans>Delete</Trans>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => edit(doc.content)}>
              <Trans>Edit</Trans>
            </Button>
          </>
        )}
      </header>
      {saveError || changedMeanwhile ? (
        <p role="alert" className="px-4 pt-2 text-body text-destructive">
          {saveError ?? t`This doc changed while you were editing.`}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
          {draft ? (
            <Textarea
              aria-label={t`Edit ${title}`}
              value={draft.content}
              onChange={(event) => edit(event.target.value)}
              className="h-full min-h-80 resize-none font-mono"
            />
          ) : viewing ? (
            <div data-testid="doc-revision">
              <div className="mb-3 flex items-center gap-2 text-label text-muted-foreground">
                <span className="text-foreground">{t`Version ${viewing.revision}`}</span>
                <span className="flex-1">{formatRelativeTime(viewing.createdAt)}</span>
                <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
                  <Trans>Show latest</Trans>
                </Button>
                <Button size="sm" variant="outline" onClick={() => edit(viewing.content)}>
                  <Trans>Restore</Trans>
                </Button>
              </div>
              <ChatMarkdown>{viewing.content}</ChatMarkdown>
            </div>
          ) : doc.content.trim() ? (
            <ChatMarkdown>{doc.content}</ChatMarkdown>
          ) : (
            <p className="text-body text-muted-foreground">
              <Trans>Empty</Trans>
            </p>
          )}
        </div>
        {historyOpen && !draft ? (
          <aside
            className="w-56 shrink-0 overflow-auto border-s p-2"
            aria-label={t`History`}
            data-testid="doc-history"
          >
            {revisions.error ? (
              <p role="alert" className="px-1 text-body text-destructive">
                {errorText(revisions.error)}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {(revisions.data ?? []).map((revision) => {
                const by = botName(revision.editedByBotId);
                const at = formatRelativeTime(revision.createdAt);
                const current = revision.revision === doc.revision;
                return (
                  <li key={revision.revision}>
                    <button
                      type="button"
                      onClick={() => setViewing(current ? null : revision)}
                      aria-current={
                        (viewing ? viewing.revision === revision.revision : current)
                          ? "true"
                          : undefined
                      }
                      className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-start hover:bg-muted aria-[current=true]:bg-muted"
                    >
                      <span className="text-body">{t`Version ${revision.revision}`}</span>
                      <span className="text-label text-muted-foreground">
                        {by ? t`${at} by ${by}` : at}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        title={<Trans>Delete {title}?</Trans>}
        description={<Trans>Bots will no longer see it.</Trans>}
        confirmLabel={<Trans>Delete</Trans>}
        onConfirm={() => remove.run(undefined)}
        busy={remove.pending}
        error={remove.error ? errorText(remove.error) : undefined}
      />
    </article>
  );
}

/** A new shared doc: a name and its first Markdown. */
export function NewDoc({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (doc: Doc) => void;
}) {
  const { t } = useLingui();
  const stale = useDocReads();
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const create = useSave({
    save: (input: { name: string; content: string }, rpc) => rpc.docs.create(input),
    stale,
    onSaved: onCreated,
  });
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      data-testid="doc-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.run({ name, content });
      }}
    >
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <BackButton onClick={onClose} />
        <Input
          aria-label={t`Doc name`}
          placeholder={t`Name`}
          value={name}
          onChange={(event) => {
            create.reset();
            setName(event.target.value);
          }}
          className="min-w-0 flex-1"
          autoFocus
        />
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          <Trans>Discard</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={create.pending || !name.trim()}>
          <Trans>Create</Trans>
        </Button>
      </header>
      {create.error ? (
        <p role="alert" className="px-4 pt-2 text-body text-destructive">
          {isConflict(create.error)
            ? t`A doc with that name already exists.`
            : errorText(create.error)}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 px-4 py-3">
        <Textarea
          aria-label={t`Content`}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="h-full min-h-80 resize-none font-mono"
        />
      </div>
    </form>
  );
}
