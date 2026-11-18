import { Trans, useLingui } from "@lingui/react/macro";
import { canDeleteOrganization } from "@robots/core";
import { Button, Field, FieldLabel, Input } from "@robots/ui-web";
import { useId, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreateOrganizationDialog } from "../components/CreateOrganizationDialog";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import type { Organization } from "../lib/organizations";
import { organizationsQuery, useOrganizations } from "../lib/organizations";
import { useQueryUserId, useSave } from "../lib/query";
import { clearSpaceSelection, rpc, selectSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";

export function OrganizationSettingsPanel({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const { organizations, activeOrganizationId } = useOrganizations();
  const organization = organizations.find((candidate) => candidate.id === activeOrganizationId);
  if (!organization) return null;
  return (
    <OrganizationSettings
      key={organization.id}
      organization={organization}
      canDelete={canDeleteOrganization(organizations, organization)}
      onBusyChange={onBusyChange}
    />
  );
}

function OrganizationSettings({
  organization,
  canDelete,
  onBusyChange,
}: {
  organization: Organization;
  canDelete: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8" data-testid="organization-settings">
      <SettingsGroup>
        {organization.canManage ? (
          <OrganizationNameRow organization={organization} onBusyChange={onBusyChange} />
        ) : (
          <SettingsRow
            label={<Trans>Organization name</Trans>}
            control={<p className="break-words text-body">{organization.name}</p>}
          />
        )}
      </SettingsGroup>
      <SettingsGroup data-testid="new-organization">
        <SettingsRow
          label={<Trans>New organization</Trans>}
          control={
            <Button variant="outline" className="rounded-full" onClick={() => setCreating(true)}>
              <Trans>Create organization</Trans>
            </Button>
          }
        />
      </SettingsGroup>
      {canDelete ? (
        <Button
          variant="destructive"
          className="rounded-full"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trans>Delete organization</Trans>
        </Button>
      ) : null}
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      {confirmingDelete ? (
        <DeleteOrganizationDialog
          organization={organization}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => removeOrganization(organization)}
        />
      ) : null}
    </div>
  );
}

function OrganizationNameRow({
  organization,
  onBusyChange,
}: {
  organization: Organization;
  onBusyChange?: (busy: boolean) => void;
}) {
  const userId = useQueryUserId();
  const nameId = useId();
  const [draft, setDraft] = useState(organization.name);
  const rename = useSave({
    save: async (name: string, client) => {
      onBusyChange?.(true);
      try {
        return await client.organizations.rename({ organizationId: organization.id, name });
      } finally {
        onBusyChange?.(false);
      }
    },
    stale: [organizationsQuery(userId).queryKey],
    onSaved: (renamed) => setDraft(renamed.name),
  });
  const trimmed = draft.trim();
  const changed = trimmed !== "" && trimmed !== organization.name;

  return (
    <SettingsRow
      label={
        <label htmlFor={nameId}>
          <Trans>Organization name</Trans>
        </label>
      }
      control={
        <form
          className="flex max-w-full min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed) rename.run(trimmed);
          }}
        >
          <Input
            id={nameId}
            className="w-56 min-w-0"
            maxLength={60}
            value={draft}
            disabled={rename.pending}
            onChange={(event) => {
              setDraft(event.target.value);
              rename.reset();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              setDraft(organization.name);
              rename.reset();
            }}
          />
          {changed || rename.pending ? (
            <Button type="submit" className="rounded-full" disabled={rename.pending}>
              {rename.pending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
            </Button>
          ) : null}
        </form>
      }
    >
      {rename.error ? (
        <p role="alert" className="pt-2 text-body-sm text-destructive">
          {errorText(rename.error)}
        </p>
      ) : null}
    </SettingsRow>
  );
}

/** Deletes it, then reloads into the Space the server chose. */
export async function removeOrganization(organization: Organization): Promise<void> {
  const { activeSpaceId } = await rpc.organizations.remove({ organizationId: organization.id });
  if (!selectSpace(activeSpaceId)) clearSpaceSelection();
  window.location.assign("/");
}

export function DeleteOrganizationDialog({
  organization,
  onCancel,
  onConfirm,
}: {
  organization: Organization;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const confirmId = useId();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = organization.name;
  return (
    <ConfirmDialog
      onCancel={onCancel}
      title={<Trans>Delete {organization.name}?</Trans>}
      description={<Trans>This cannot be undone.</Trans>}
      error={error}
      busy={deleting}
      confirmDisabled={typed !== name}
      onConfirm={() => {
        setDeleting(true);
        setError(null);
        void onConfirm().catch((reason: unknown) => {
          setError(errorText(reason));
          setDeleting(false);
        });
      }}
      confirmLabel={deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
    >
      <Field>
        <FieldLabel htmlFor={confirmId} className="break-words">
          {t`Type ${name} to confirm`}
        </FieldLabel>
        <Input
          id={confirmId}
          value={typed}
          disabled={deleting}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
