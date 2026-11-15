import { listRunsEndedSince } from "../runs.js";
import type { RouterContext } from "./context.js";

/** Reads for the Today page, a Labs feature. */
export function todayRoutes(ctx: RouterContext) {
  const { deps, todayEnabled } = ctx;
  return {
    today: {
      runs: todayEnabled.today.runs.handler(({ context, input }) =>
        listRunsEndedSince(deps.prisma, context.actor, new Date(input.since)),
      ),
    },
  };
}
