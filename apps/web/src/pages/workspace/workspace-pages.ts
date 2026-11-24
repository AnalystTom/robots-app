import type { LabFeature } from "@robots/contracts";
import { useSyncExternalStore } from "react";
import { getLabs, subscribeLabs } from "../../lib/bootstrap";

export const WORKSPACE_PAGES = [
  { id: "tasks", lab: "board", path: "/app/tasks" },
  { id: "email", lab: "email", path: "/app/email" },
  { id: "docs", lab: "docs", path: "/app/docs" },
] as const satisfies ReadonlyArray<{ id: string; lab: LabFeature; path: string }>;

export type WorkspacePage = (typeof WORKSPACE_PAGES)[number];
export type WorkspacePageId = WorkspacePage["id"];

export function workspacePagesFor(labs: readonly LabFeature[]): WorkspacePage[] {
  return WORKSPACE_PAGES.filter((page) => labs.includes(page.lab));
}

export function useWorkspacePages(): WorkspacePage[] {
  const labs = useSyncExternalStore(
    subscribeLabs,
    () => getLabs().join(","),
    () => "",
  );
  return workspacePagesFor(labs.split(",") as LabFeature[]);
}
