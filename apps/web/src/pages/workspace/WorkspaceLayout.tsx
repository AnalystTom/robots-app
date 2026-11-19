import { Trans, useLingui } from "@lingui/react/macro";
import { buttonVariants } from "@robots/ui-web";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WindowChrome } from "../WindowChrome";
import { WorkspaceNav } from "./workspace-nav";
import type { WorkspacePageId } from "./workspace-pages";
import { useWorkspacePages } from "./workspace-pages";

export function WorkspaceLayout({
  page,
  title,
  actions,
  children,
}: {
  page: WorkspacePageId;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const pages = useWorkspacePages();
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 flex-col gap-2 border-e border-sidebar-border bg-sidebar p-2.5 md:flex">
          <Link
            to="/app"
            className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-body text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <ChevronLeft className="size-4 text-muted-foreground" aria-hidden="true" />
            <Trans>Chats</Trans>
          </Link>
          <WorkspaceNav pages={pages} current={page} onOpen={(next) => navigate(next.path)} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <Link
              to="/app"
              aria-label={t`Back to chats`}
              className={`${buttonVariants({ variant: "ghost", size: "icon" })} md:hidden`}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
            <h1 className="flex-1 font-medium">{title}</h1>
            {actions}
          </header>
          <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
