import { Trans } from "@lingui/react/macro";
import { WorkspaceLayout } from "./WorkspaceLayout";

export function TodayPage() {
  return (
    <WorkspaceLayout page="today" title={<Trans>Today</Trans>}>
      <p className="p-4 text-body text-muted-foreground">
        <Trans>Coming soon.</Trans>
      </p>
    </WorkspaceLayout>
  );
}
