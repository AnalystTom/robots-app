import { Trans } from "@lingui/react/macro";
import { WorkspaceLayout } from "./WorkspaceLayout";

export function DocsPage() {
  return (
    <WorkspaceLayout page="docs" title={<Trans>Docs</Trans>}>
      <p className="p-4 text-body text-muted-foreground">
        <Trans>Coming soon.</Trans>
      </p>
    </WorkspaceLayout>
  );
}
