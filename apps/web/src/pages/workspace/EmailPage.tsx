import { Trans } from "@lingui/react/macro";
import { WorkspaceLayout } from "./WorkspaceLayout";

export function EmailPage() {
  return (
    <WorkspaceLayout page="email" title={<Trans>Email</Trans>}>
      <p className="p-4 text-body text-muted-foreground">
        <Trans>Coming soon.</Trans>
      </p>
    </WorkspaceLayout>
  );
}
