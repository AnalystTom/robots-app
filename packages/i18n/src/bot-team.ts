import { i18n } from "@lingui/core";

function botTeamIncompleteError(created: number, total: number): Error {
  return new Error(
    i18n._({
      id: "JZS9j_",
      message: "Created {created} of {total} bots. Try again to finish the team.",
      values: { created, total },
    }),
  );
}

export async function createBotTeam<Bot>(
  create: () => Promise<{ bots: Bot[]; failed: string[] }>,
  refreshBotReads: () => unknown,
): Promise<Bot[]> {
  const { bots, failed } = await create();
  if (!failed.length) return bots;
  await refreshBotReads();
  throw botTeamIncompleteError(bots.length, bots.length + failed.length);
}
