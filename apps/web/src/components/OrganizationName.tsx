import { Trans } from "@lingui/react/macro";
import { marksPersonalOrganization } from "@robots/core";
import type { Organization } from "../lib/organizations";

export function OrganizationName({
  organization,
  organizations,
}: {
  organization: Organization;
  organizations: readonly Organization[];
}) {
  return (
    <>
      <span className="min-w-0 truncate">{organization.name}</span>
      {marksPersonalOrganization(organizations, organization) ? (
        <span className="ms-auto shrink-0 text-body-sm text-muted-foreground">
          <Trans>Personal</Trans>
        </span>
      ) : null}
    </>
  );
}
