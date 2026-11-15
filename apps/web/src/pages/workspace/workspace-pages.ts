import type { LabFeature } from "@robots/contracts";
import { useSyncExternalStore } from "react";
import { getLabs, subscribeLabs } from "../../lib/bootstrap";

/** The workspace pages in sidebar order; each is a Labs feature until it graduates. */
export const WORKSPACE_PAGES = [
  { id: "today", lab: "today", path: "/app/today" },
  { id: "tasks", lab: "board", path: "/app/tasks" },
  { id: "email", lab: "email", path: "/app/email" },
  { id: "docs", lab: "docs", path: "/app/docs" },
] as const satisfies ReadonlyArray<{ id: string; lab: LabFeature; path: string }>;

export type WorkspacePage = (typeof WORKSPACE_PAGES)[number];
export type WorkspacePageId = WorkspacePage["id"];

export function workspacePagesFor(labs: readonly LabFeature[]): WorkspacePage[] {
  return WORKSPACE_PAGES.filter((page) => labs.includes(page.lab));
}

/** The pages the account has turned on, following Labs changes without a reload. */
export function useWorkspacePages(): WorkspacePage[] {
  // A joined string, so a fresh but equal list is not a change.
  const labs = useSyncExternalStore(
    subscribeLabs,
    () => getLabs().join(","),
    () => "",
  );
  return workspacePagesFor(labs.split(",") as LabFeature[]);
}
