import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, RunActivityRow, Ticket } from "@robots/contracts";
import { activitySections } from "@robots/core";
import { BotAvatar, SectionHeading } from "@robots/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { followStream } from "../../lib/follow-stream";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { spaceChanged } from "../../lib/space-changes";
import { useTicketStatusLabels } from "../../lib/ticket-status";
import { errorText } from "../../lib/user-error";
import { ActivityRow } from "../ActivityList";
import { useBoard } from "../board/use-board";
import { NEEDS_YOU_STATUSES } from "./task-columns";
import { dayPart, firstName, startOfDay, workingBotNames } from "./today-summary";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { useWorkspacePages } from "./workspace-pages";

const NO_RUNS: RunActivityRow[] = [];
const live = { refetchOnWindowFocus: "always" } as const;

/** What the bots are doing, what needs the user, and what finished today. */
export function TodayPage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const boardOn = useWorkspacePages().some((page) => page.id === "tasks");
  const board = useBoard({ enabled: boardOn });
  const statusLabels = useTicketStatusLabels();
  const since = startOfDay();
  const me = useQuery(queries.me.queryOptions());
  const bots = useQuery({ ...queries.bots.list.queryOptions(), ...live });
  const groups = useQuery({ ...queries.groups.list.queryOptions(), ...live });
  const active = useQuery(queries.runs.list.queryOptions({ input: { filter: "active" }, ...live }));
  const recent = useQuery(queries.runs.list.queryOptions({ input: { filter: "recent" }, ...live }));
  const today = useQuery(queries.today.runs.queryOptions({ input: { since }, ...live }));

  // Runs and chats are read again when the server says they changed, and on each reconnect.
  useEffect(() => {
    const chatsChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queries.bots.list.key() });
      void queryClient.invalidateQueries({ queryKey: queries.groups.list.key() });
    };
    return followStream(
      (signal) => rpc.notifications.subscribe(undefined, { signal }),
      (frame) => {
        if (frame.type === "runs") {
          void spaceChanged("runs", queryClient);
          chatsChanged();
        } else if (frame.type === "roster") chatsChanged();
      },
    );
  }, [queries, queryClient]);

  const botList = bots.data ?? [];
  const botsById = useMemo(() => new Map(botList.map((bot) => [bot.id, bot])), [botList]);
  const sections = activitySections({
    active: active.data?.runs ?? NO_RUNS,
    recent: recent.data?.runs ?? NO_RUNS,
    bots: botList,
    groups: groups.data ?? [],
  });
  const tickets = boardOn
    ? board.tickets.filter((ticket) => NEEDS_YOU_STATUSES.includes(ticket.status))
    : [];
  const needs = sections.attention.length + tickets.length;
  const finished = today.data?.finished ?? 0;
  const failed =
    me.error ?? bots.error ?? groups.error ?? active.error ?? recent.error ?? today.error;
  const ready = active.isSuccess && recent.isSuccess && bots.isSuccess && groups.isSuccess;

  const name = firstName(me.data?.name);
  const part = dayPart(new Date().getHours());
  const greeting =
    part === "morning"
      ? name
        ? t`Good morning, ${name}`
        : t`Good morning`
      : part === "afternoon"
        ? name
          ? t`Good afternoon, ${name}`
          : t`Good afternoon`
        : name
          ? t`Good evening, ${name}`
          : t`Good evening`;
  const working = workingBotNames(sections.working);
  const names = new Intl.ListFormat(i18n.locale || "en", { type: "conjunction" }).format(working);
  const workingClause =
    working.length === 0
      ? t`No bots are working`
      : working.length === 1
        ? t`${names} is working`
        : t`${names} are working`;
  const needsClause =
    needs === 0
      ? t`nothing needs you`
      : t`${plural(needs, { one: "# thing needs you", other: "# things need you" })}`;
  const finishedSentence =
    finished > 0
      ? t`Your bots finished ${plural(finished, { one: "# run", other: "# runs" })} today.`
      : "";
  const openRun = (run: RunActivityRow) =>
    navigate(run.groupId ? `/app/g/${run.groupId}` : `/app/${run.botId}`);

  return (
    <WorkspaceLayout page="today" title={<Trans>Today</Trans>}>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
        <div className="space-y-2">
          <SectionHeading as="h2" variant="heading">
            {greeting}
          </SectionHeading>
          {ready ? (
            <p data-testid="today-summary" className="text-body text-muted-foreground">
              {t`${workingClause}, ${needsClause}.`} {finishedSentence}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-body text-destructive">
              {errorText(failed)}
            </p>
          ) : null}
        </div>

        {needs > 0 ? (
          <section aria-labelledby="today-needs-you" className="space-y-1">
            <SectionHeading id="today-needs-you" as="h3" variant="label" className="px-2.5">
              <Trans>Needs you</Trans>
            </SectionHeading>
            {tickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                bot={board.bots.find((bot) => bot.id === ticket.assigneeBotId)}
                status={statusLabels[ticket.status]}
                onOpen={() => navigate(`/app/tasks?ticket=${encodeURIComponent(ticket.id)}`)}
              />
            ))}
            {sections.attention.map((run) => (
              <ActivityRow
                key={run.runId}
                run={run}
                bot={botsById.get(run.botId)}
                detailed
                onOpen={() => openRun(run)}
              />
            ))}
          </section>
        ) : null}

        <section aria-labelledby="today-so-far" className="space-y-1">
          <SectionHeading id="today-so-far" as="h3" variant="label" className="px-2.5">
            <Trans>Today so far</Trans>
          </SectionHeading>
          {sections.working.map((run) => (
            <ActivityRow
              key={run.runId}
              run={run}
              bot={botsById.get(run.botId)}
              detailed={false}
              onOpen={() => openRun(run)}
            />
          ))}
          {(today.data?.runs ?? NO_RUNS).map((run) => (
            <ActivityRow
              key={run.runId}
              run={run}
              bot={botsById.get(run.botId)}
              detailed
              onOpen={() => openRun(run)}
            />
          ))}
          {today.isSuccess && today.data.runs.length === 0 && sections.working.length === 0 ? (
            <p className="px-2.5 text-body-sm text-muted-foreground">
              <Trans>Nothing yet today.</Trans>
            </p>
          ) : null}
        </section>
      </div>
    </WorkspaceLayout>
  );
}

function TicketRow({
  ticket,
  bot,
  status,
  onOpen,
}: {
  ticket: Ticket;
  bot?: Bot;
  status: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`today-ticket-${ticket.id}`}
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-accent"
    >
      {bot ? (
        <BotAvatar identity={bot.id} color={bot.color} avatarSet={bot.avatarSet} size={28} />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-body font-medium">{ticket.title}</span>
          <span className="shrink-0 text-label text-warning">{status}</span>
        </div>
        <span className="flex min-w-0 gap-2 text-body-sm text-muted-foreground">
          <span className="shrink-0">{ticket.ref}</span>
          {bot ? <span className="truncate">{bot.name}</span> : null}
        </span>
      </div>
    </button>
  );
}
