import type { Bot, Ticket } from "@robots/contracts";
import { isRetryableError, reconnectDelayMs, retryDelayMs } from "@robots/core";
import { fetchFresh } from "@robots/core/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

const NO_TICKETS: Ticket[] = [];
const NO_BOTS: Bot[] = [];

/**
 * The board's tickets and bots, read again on each `boards.subscribe` signal (and each
 * reconnect), with any open ticket's comments. Off, it reads and follows nothing.
 */
export function useBoard({ enabled = true }: { enabled?: boolean } = {}) {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const ticketsOptions = queries.tickets.list.queryOptions({ input: {} });
  const ticketsQuery = useQuery({ ...ticketsOptions, enabled });
  const botsQuery = useQuery({ ...queries.bots.list.queryOptions(), enabled });
  const [streamError, setError] = useState("");
  const loadFailed = ticketsQuery.error ?? botsQuery.error;

  useEffect(() => {
    if (!enabled) return;
    let currentController: AbortController | undefined;
    let active = true;
    // Live events refresh the board and any open ticket's comments.
    const refreshComments = (ticketId?: string) =>
      void queryClient.invalidateQueries({
        queryKey: ticketId
          ? queries.tickets.comments.queryKey({ input: { ticketId } })
          : queries.tickets.comments.key(),
      });
    let cancelRetry: (() => void) | undefined;
    void (async () => {
      while (active) {
        const controller = new AbortController();
        currentController = controller;
        let failure: unknown;
        let opened = false;
        try {
          const stream = await rpc.boards.subscribe(undefined, {
            signal: controller.signal,
          });
          if (!active) return;
          await fetchFresh(queryClient, ticketsOptions);
          if (!active) return;
          refreshComments();
          setError("");
          opened = true;
          for await (const event of stream) {
            if (!active) return;
            refreshComments(event.ticketId);
            await fetchFresh(queryClient, ticketsOptions);
          }
        } catch (cause) {
          failure = cause;
          if (active) setError(errorText(cause));
        } finally {
          controller.abort();
        }
        if (!active || !isRetryableError(failure)) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(
            resolve,
            opened ? reconnectDelayMs(failure) : retryDelayMs(failure, 1_000),
          );
          cancelRetry = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        cancelRetry = undefined;
      }
    })();
    return () => {
      active = false;
      currentController?.abort();
      cancelRetry?.();
    };
  }, [queries, enabled]);

  return {
    tickets: ticketsQuery.data?.tickets ?? NO_TICKETS,
    bots: botsQuery.data ?? NO_BOTS,
    /** The query key a save that changes tickets makes stale. */
    ticketsKey: ticketsOptions.queryKey,
    error: streamError || (loadFailed ? errorText(loadFailed) : ""),
    /** A read sent after a change, so an older one in flight cannot bring back the old board. */
    reload: () => fetchFresh(queryClient, ticketsOptions).then(() => undefined),
  };
}
