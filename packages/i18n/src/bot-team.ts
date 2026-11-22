import { i18n } from "@lingui/core";

export function botTeamIncompleteError(created: number, total: number): Error {
  return new Error(
    i18n._({
      id: "JZS9j_",
      message: "Created {created} of {total} bots. Try again to finish the team.",
      values: { created, total },
    }),
  );
}
