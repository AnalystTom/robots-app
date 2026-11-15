import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@robots/chat-ui/web";
import type { Bot, Ticket, TicketPriority, TicketStatus } from "@robots/contracts";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TITLE_MAX_LENGTH,
} from "@robots/contracts";
import { fetchFresh, writeSaved } from "@robots/core/query";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@robots/ui-web";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { useTicketPriorityLabels } from "../../lib/ticket-priority";
import { useTicketStatusLabels } from "../../lib/ticket-status";
import { errorText } from "../../lib/user-error";

/** Creates a ticket, or edits, moves and comments on one. */
export function TicketDialog({
  ticket,
  bots,
  onClose,
  onSaved,
}: {
  ticket: Ticket | null;
  bots: Bot[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLingui();
  const formId = useId();
  const statuses = useTicketStatusLabels();
  const priorities = useTicketPriorityLabels();
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [owner, setOwner] = useState(ticket?.assigneeBotId ?? bots[0]?.id ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "todo");
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? "normal");
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const commentsOptions = queries.tickets.comments.queryOptions({
    input: ticket ? { ticketId: ticket.id } : skipToken,
  });
  const commentsQuery = useQuery(commentsOptions);
  const comments = commentsQuery.data ?? [];
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownError = error || (commentsQuery.error ? errorText(commentsQuery.error) : "");

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (ticket)
        await rpc.tickets.update({
          id: ticket.id,
          ...(title !== ticket.title ? { title } : {}),
          ...(description !== (ticket.description ?? "") ? { description } : {}),
          ...(owner !== (ticket.assigneeBotId ?? bots[0]?.id ?? "")
            ? { assigneeBotId: owner }
            : {}),
          ...(status !== ticket.status ? { status } : {}),
          ...(priority !== ticket.priority ? { priority } : {}),
        });
      else
        await rpc.tickets.create({
          title,
          description,
          assigneeBotId: owner,
          priority,
        });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function comment() {
    if (!ticket) return;
    setBusy(true);
    setError("");
    try {
      const row = await rpc.tickets.comment({ ticketId: ticket.id, body });
      const options = queries.tickets.comments.queryOptions({ input: { ticketId: ticket.id } });
      // A list already on screen shows the comment at once, unless a read already brought it.
      if (queryClient.getQueryData(options.queryKey)) {
        await writeSaved(queryClient, options.queryKey, (previous = []) =>
          previous.some((item) => item.id === row.id) ? previous : [...previous, row],
        );
      }
      setBody("");
      // Saving cancelled any read in flight, so the whole list is read again after the post.
      void fetchFresh(queryClient, options).catch(() => undefined);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket?.title ?? t`New ticket`}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${formId}-title`} className="block space-y-1 text-body">
            <span>
              <Trans>Title</Trans>
            </span>
            <Input
              id={`${formId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TICKET_TITLE_MAX_LENGTH}
              required
            />
          </label>
          <label htmlFor={`${formId}-description`} className="block space-y-1 text-body">
            <span>
              <Trans>Description</Trans>
            </span>
            <Textarea
              id={`${formId}-description`}
              data-testid="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={TICKET_DESCRIPTION_MAX_LENGTH}
            />
          </label>
          <label htmlFor={`${formId}-owner`} className="block space-y-1 text-body">
            <span>
              <Trans>Owner</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-owner`}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              required
            >
              {bots.map((bot) => (
                <NativeSelectOption key={bot.id} value={bot.id}>
                  {bot.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {ticket ? (
            <label htmlFor={`${formId}-status`} className="block space-y-1 text-body">
              <span>
                <Trans>Status</Trans>
              </span>
              <NativeSelect
                className="w-full"
                id={`${formId}-status`}
                value={status}
                onChange={(event) => setStatus(event.target.value as TicketStatus)}
              >
                {TICKET_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {statuses[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <label htmlFor={`${formId}-priority`} className="block space-y-1 text-body">
            <span>
              <Trans>Priority</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-priority`}
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {priorities[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !title.trim() || !owner}>
              {ticket ? t`Save` : t`Create`}
            </Button>
          </div>
        </form>
        {ticket ? (
          <div data-testid="ticket-comments" className="space-y-3 border-t pt-3">
            {comments.map((row) => (
              <div key={row.id} className="text-body">
                <div className="mb-1 flex items-center justify-between gap-3 text-label text-muted-foreground">
                  <span>{row.authorName}</span>
                  <time dateTime={row.createdAt}>{formatRelativeTime(row.createdAt)}</time>
                </div>
                <ChatMarkdown>{row.body}</ChatMarkdown>
              </div>
            ))}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void comment();
              }}
            >
              <Textarea
                aria-label={t`Comment`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={TICKET_COMMENT_MAX_LENGTH}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !body.trim()}>
                  <Trans>Comment</Trans>
                </Button>
              </div>
            </form>
          </div>
        ) : null}
        {shownError ? (
          <p role="alert" className="text-body text-destructive">
            {shownError}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
