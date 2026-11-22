import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSave, useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

export function HostBrowserSignInDialog({
  botId,
  open,
  onOpenChange,
}: {
  botId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queries = useSpaceQueries();
  const profileId = useId();
  const [chosenProfile, setChosenProfile] = useState<string | null>(null);
  const [sites, setSites] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const profilesQuery = useQuery({
    ...queries.computer.hostBrowserProfiles.queryOptions({ input: { botId } }),
    enabled: open,
  });
  const profiles = profilesQuery.data?.profiles ?? [];
  const profile = profiles.find((item) => item.id === chosenProfile) ?? profiles[0];
  const signIn = useSave({
    save: (input: { profile: string; sites: string[] }, rpc) =>
      rpc.computer.importHostBrowserSessions({ botId, ...input }),
    onSaved: () => close(),
  });
  const shownSites = (profile?.sites ?? []).filter((site) =>
    site.includes(filter.trim().toLowerCase()),
  );
  const chosenSites = shownSites.filter((site) => sites.has(site));

  function close() {
    onOpenChange(false);
    setSites(new Set());
    setFilter("");
    signIn.reset();
  }

  function toggle(site: string, checked: boolean) {
    const next = new Set(sites);
    if (checked) next.add(site);
    else next.delete(site);
    setSites(next);
    signIn.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (signIn.pending) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent data-testid="host-browser-sign-in">
        <DialogHeader>
          <DialogTitle>
            <Trans>Sign in from this computer</Trans>
          </DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (profile && chosenSites.length > 0)
              signIn.run({ profile: profile.id, sites: chosenSites });
          }}
        >
          {profilesQuery.error ? (
            <FieldError>{errorText(profilesQuery.error)}</FieldError>
          ) : profilesQuery.isSuccess && profiles.length === 0 ? (
            <p className="text-body text-muted-foreground">
              <Trans>No browser profiles on this computer.</Trans>
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor={profileId}>
                  <Trans>Browser profile</Trans>
                </FieldLabel>
                <NativeSelect
                  id={profileId}
                  value={profile?.id ?? ""}
                  disabled={signIn.pending || !profile}
                  onChange={(event) => {
                    setChosenProfile(event.target.value);
                    setSites(new Set());
                    signIn.reset();
                  }}
                >
                  {profiles.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Input
                aria-label={t`Find a site`}
                placeholder={t`Find a site`}
                value={filter}
                disabled={!profile}
                onChange={(event) => setFilter(event.target.value)}
              />
              <ul className="max-h-64 overflow-y-auto" aria-label={t`Sites`}>
                {shownSites.map((site) => (
                  <li key={site}>
                    <FieldLabel className="flex items-center gap-2 py-1 text-body">
                      <Checkbox
                        checked={sites.has(site)}
                        disabled={signIn.pending}
                        onCheckedChange={(checked) => toggle(site, checked === true)}
                      />
                      {site}
                    </FieldLabel>
                  </li>
                ))}
              </ul>
            </>
          )}
          <FieldError>{signIn.error ? errorText(signIn.error) : null}</FieldError>
          <DialogFooter>
            <Button type="submit" disabled={signIn.pending || !profile || chosenSites.length === 0}>
              <Trans>Sign in</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
