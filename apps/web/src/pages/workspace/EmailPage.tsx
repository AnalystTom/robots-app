import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, EmailFolder, EmailMailbox, EmailSummary } from "@robots/contracts";
import {
  BotAvatar,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  SectionHeading,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@robots/ui-web";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Mail, MessageCircle, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BotEmailAddressField } from "../../components/BotEmailAddressField";
import { appendComposerDraftText, composerDraftKey } from "../../lib/composer-draft";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { errorText } from "../../lib/user-error";
import { WorkspaceLayout } from "./WorkspaceLayout";

type BotLook = Pick<Bot, "id" | "color">;

/**
 * The mail the caller's bots received at their addresses and the mail they sent. The selected
 * mailbox, folder and message live in the URL, so a phone's back button returns to the list.
 */
export function EmailPage() {
  const queries = useSpaceQueries();
  const [params, setParams] = useSearchParams();
  const mailboxesQuery = useQuery(queries.email.mailboxes.queryOptions());
  const bots = useQuery(queries.bots.list.queryOptions()).data ?? [];
  const domain = mailboxesQuery.data?.domain ?? null;
  const all = mailboxesQuery.data?.mailboxes ?? [];
  const mailboxes = all.filter((mailbox) => mailbox.address);
  const mailbox =
    mailboxes.find((candidate) => candidate.botId === params.get("bot")) ?? mailboxes[0];
  const folder: EmailFolder = params.get("folder") === "sent" ? "sent" : "inbox";
  const messageId = mailbox ? params.get("message") : null;

  const show = (next: { bot?: string; folder?: EmailFolder; message?: string | null }) => {
    const search = new URLSearchParams(params);
    if (next.bot) search.set("bot", next.bot);
    if (next.folder) search.set("folder", next.folder);
    if (next.message) search.set("message", next.message);
    else search.delete("message");
    // Opening a message is a step back can undo; switching lists replaces the place.
    setParams(search, { replace: !next.message });
  };

  let body: ReactNode;
  if (mailboxesQuery.isPending) {
    body = <Loading />;
  } else if (mailboxesQuery.isError) {
    body = <Failed error={mailboxesQuery.error} />;
  } else if (!domain) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mail />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>This server doesn't receive email</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>Bots get their own addresses once the server's admin turns on email.</Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (!mailbox) {
    body = <NoMailboxes domain={domain} unclaimed={all} bots={bots} />;
  } else {
    body = (
      <div className="flex h-full min-h-0">
        <div
          className={`min-h-0 w-full flex-col border-e md:flex md:w-80 md:shrink-0 ${
            messageId ? "hidden" : "flex"
          }`}
        >
          <MailboxList
            mailboxes={mailboxes}
            current={mailbox.botId}
            bots={bots}
            onOpen={(bot) => show({ bot, message: null })}
          />
          <Tabs
            value={folder}
            onValueChange={(next) => show({ folder: next as EmailFolder, message: null })}
            className="border-b px-3 py-2"
          >
            <TabsList className="w-full">
              <TabsTrigger value="inbox">
                <Trans>Inbox</Trans>
              </TabsTrigger>
              <TabsTrigger value="sent">
                <Trans>Sent</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <MessageList
            botId={mailbox.botId}
            folder={folder}
            current={messageId}
            onOpen={(message) => show({ message })}
          />
        </div>
        <div className={`min-h-0 min-w-0 flex-1 md:block ${messageId ? "block" : "hidden"}`}>
          {messageId ? (
            <Reader id={messageId} mailbox={mailbox} onBack={() => show({ message: null })} />
          ) : (
            <Empty className="h-full">
              <EmptyDescription>
                <Trans>Choose a message to read it.</Trans>
              </EmptyDescription>
            </Empty>
          )}
        </div>
      </div>
    );
  }

  return (
    <WorkspaceLayout page="email" title={<Trans>Email</Trans>}>
      {body}
    </WorkspaceLayout>
  );
}

function Loading() {
  const { t } = useLingui();
  return (
    <div className="grid place-items-center py-10 text-muted-foreground">
      <Spinner aria-label={t`Loading…`} />
    </div>
  );
}

function Failed({ error }: { error: unknown }) {
  return (
    <p role="alert" className="p-4 text-body text-destructive">
      {errorText(error)}
    </p>
  );
}

function Avatar({ bots, botId, size }: { bots: readonly BotLook[]; botId: string; size: number }) {
  const bot = bots.find((candidate) => candidate.id === botId);
  return <BotAvatar color={bot?.color ?? ""} identity={botId} size={size} className="shrink-0" />;
}

/** No bot has an address yet: say where mail arrives and offer each bot one. */
function NoMailboxes({
  domain,
  unclaimed,
  bots,
}: {
  domain: string;
  unclaimed: readonly EmailMailbox[];
  bots: readonly BotLook[];
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <Empty className="p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mail />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>No mailboxes yet</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>
              Each bot can receive mail at its own address, which you can also find in its settings.
            </Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      {unclaimed.length ? (
        <ul className="flex flex-col gap-4">
          {unclaimed.map((mailbox) => (
            <li key={mailbox.botId} className="flex items-start gap-3">
              <Avatar bots={bots} botId={mailbox.botId} size={32} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <SectionHeading as="h2" variant="label">
                  {mailbox.botName}
                </SectionHeading>
                <BotEmailAddressField
                  bot={{ id: mailbox.botId, name: mailbox.botName }}
                  domain={domain}
                  address={null}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MailboxList({
  mailboxes,
  current,
  bots,
  onOpen,
}: {
  mailboxes: readonly EmailMailbox[];
  current: string;
  bots: readonly BotLook[];
  onOpen: (botId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <nav aria-label={t`Mailboxes`} className="flex flex-col gap-0.5 border-b p-2">
      {mailboxes.map((mailbox) => (
        <button
          key={mailbox.botId}
          type="button"
          aria-current={mailbox.botId === current ? "true" : undefined}
          onClick={() => onOpen(mailbox.botId)}
          className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent ${
            mailbox.botId === current ? "bg-accent" : ""
          }`}
        >
          <Avatar bots={bots} botId={mailbox.botId} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium">{mailbox.botName}</span>
            <span className="block truncate font-mono text-label text-muted-foreground">
              {mailbox.address}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}

/** Who a message is from, or for mail the bot sent, who it went to. */
function correspondent(message: EmailSummary): string {
  if (message.sent) return message.to.join(", ");
  return message.fromName || message.fromAddress;
}

function MessageList({
  botId,
  folder,
  current,
  onOpen,
}: {
  botId: string;
  folder: EmailFolder;
  current: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const pages = useInfiniteQuery(
    queries.email.messages.infiniteOptions({
      input: (cursor: string | undefined) => ({ botId, folder, ...(cursor ? { cursor } : {}) }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  if (pages.isPending) return <Loading />;
  const messages = (pages.data?.pages ?? []).flatMap((page) => page.messages);
  if (pages.isError && messages.length === 0) return <Failed error={pages.error} />;
  if (messages.length === 0) {
    return (
      <p className="p-4 text-body text-muted-foreground">
        {folder === "sent" ? <Trans>Nothing sent yet.</Trans> : <Trans>No mail yet.</Trans>}
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <ul aria-label={folder === "sent" ? t`Sent mail` : t`Inbox`}>
        {messages.map((message) => (
          <li key={message.id} className="border-b">
            <button
              type="button"
              aria-current={message.id === current ? "true" : undefined}
              onClick={() => onOpen(message.id)}
              className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-accent ${
                message.id === current ? "bg-accent" : ""
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-body font-medium">
                  {message.sent ? t`To ${correspondent(message)}` : correspondent(message)}
                </span>
                <time
                  dateTime={message.receivedAt}
                  className="shrink-0 text-label text-muted-foreground"
                >
                  {formatRelativeTime(message.receivedAt)}
                </time>
              </span>
              <span className="truncate text-body-sm">{message.subject || t`(No subject)`}</span>
              {message.preview ? (
                <span className="truncate text-body-sm text-muted-foreground">
                  {message.preview}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {pages.hasNextPage || pages.isFetchNextPageError ? (
        <div className="p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            {pages.isFetchNextPageError ? <Trans>Try again</Trans> : <Trans>Load more</Trans>}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Reader({
  id,
  mailbox,
  onBack,
}: {
  id: string;
  mailbox: EmailMailbox;
  onBack: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const navigate = useNavigate();
  const query = useQuery(queries.email.message.queryOptions({ input: { id } }));
  const message = query.data;
  const ask = () => {
    if (message) {
      // A draft the owner finishes and sends; the id lets the bot read the message itself.
      appendComposerDraftText(
        composerDraftKey({ botId: message.botId }),
        t`About the email "${message.subject}" (id ${message.id}):`,
      );
    }
    navigate(`/app/${mailbox.botId}`);
  };
  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={t`Message`}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t`Back`}
          onClick={onBack}
        >
          <ChevronLeft />
        </Button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={ask} disabled={!message}>
          <MessageCircle />
          {t`Ask ${mailbox.botName}`}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Failed error={query.error} />
        ) : message ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <SectionHeading as="h2" variant="heading" className="break-words">
              {message.subject || t`(No subject)`}
            </SectionHeading>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-muted-foreground">
                <Trans>From</Trans>
              </dt>
              <dd className="min-w-0 break-words">
                {message.fromName
                  ? `${message.fromName} <${message.fromAddress}>`
                  : message.fromAddress}
                {!message.sent && !message.verified ? (
                  <span className="ms-2 text-label text-warning">
                    <Trans>Unverified sender</Trans>
                  </span>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">
                <Trans>To</Trans>
              </dt>
              <dd className="min-w-0 break-words">{message.to.join(", ")}</dd>
              {message.cc.length ? (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Cc</Trans>
                  </dt>
                  <dd className="min-w-0 break-words">{message.cc.join(", ")}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">
                <Trans>Date</Trans>
              </dt>
              <dd>
                <time dateTime={message.receivedAt}>
                  {new Date(message.receivedAt).toLocaleString()}
                </time>
              </dd>
            </dl>
            {message.files.length ? (
              <ul className="flex flex-wrap gap-2">
                {message.files.map((file, index) => (
                  <li
                    // Names can repeat.
                    key={`${index}:${file.name}`}
                    className={`flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-label ${
                      file.kept ? "" : "text-muted-foreground line-through"
                    }`}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    {file.name}
                  </li>
                ))}
              </ul>
            ) : null}
            {/* The sender's text, rendered as text: nothing in it is markup or runs. */}
            <div data-testid="email-text" className="whitespace-pre-wrap break-words text-body">
              {message.text}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
