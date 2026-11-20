import type { LabFeature } from "@robots/contracts";
import { WORKSPACE_PAGES } from "@robots/contracts";
import { useLabs } from "../../lib/bootstrap";

export type WorkspacePage = (typeof WORKSPACE_PAGES)[number];
export type WorkspacePageId = WorkspacePage["id"];

export function workspacePagesFor(labs: readonly LabFeature[]): WorkspacePage[] {
  return WORKSPACE_PAGES.filter((page) => labs.includes(page.lab));
}

export function useWorkspacePages(): WorkspacePage[] {
  return workspacePagesFor(useLabs());
}
