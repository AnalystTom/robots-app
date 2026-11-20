import { useLingui } from "@lingui/react/macro";
import { FileText, Mail, SquareKanban } from "lucide-react";
import type { ComponentType } from "react";
import type { WorkspacePage, WorkspacePageId } from "./workspace-pages";

const ICONS: Record<
  WorkspacePageId,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  tasks: SquareKanban,
  email: Mail,
  docs: FileText,
};

export function useWorkspacePageLabels(): Record<WorkspacePageId, string> {
  const { t } = useLingui();
  return { tasks: t`Tasks`, email: t`Email`, docs: t`Docs` };
}

export function WorkspaceNav({
  pages,
  current,
  mini = false,
  onOpen,
}: {
  pages: readonly WorkspacePage[];
  current?: WorkspacePageId;
  mini?: boolean;
  onOpen: (page: WorkspacePage) => void;
}) {
  const { t } = useLingui();
  const labels = useWorkspacePageLabels();
  if (pages.length === 0) return null;
  return (
    <nav aria-label={t`Workspace`} data-testid="workspace-nav" className="flex flex-col gap-0.5">
      {pages.map((page) => {
        const Icon = ICONS[page.id];
        const active = page.id === current;
        return (
          <button
            key={page.id}
            type="button"
            data-testid={`workspace-nav-${page.id}`}
            aria-current={active ? "page" : undefined}
            aria-label={mini ? labels[page.id] : undefined}
            title={mini ? labels[page.id] : undefined}
            onClick={() => onOpen(page)}
            className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-body text-sidebar-foreground hover:bg-sidebar-accent ${
              active ? "bg-sidebar-accent font-medium" : ""
            } ${mini ? "justify-center px-0" : ""}`}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            {mini ? null : <span className="truncate">{labels[page.id]}</span>}
          </button>
        );
      })}
    </nav>
  );
}
