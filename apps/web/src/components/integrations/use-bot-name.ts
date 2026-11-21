import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";

export function useBotName(botId: string | undefined): string {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const bots = useQuery(queries.bots.list.queryOptions()).data;
  return bots?.find((bot) => bot.id === botId)?.name ?? t`Your bot`;
}
