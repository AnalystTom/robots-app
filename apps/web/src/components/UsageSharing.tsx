import { Trans, useLingui } from "@lingui/react/macro";
import { AI_PRIVACY_URL } from "@robots/contracts";
import { Button, Label, Switch } from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSave, useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

function useSaveUsageSharing(onSaved?: () => void) {
  const queries = useSpaceQueries();
  return useSave({
    save: (usageSharing: boolean, rpc) => rpc.preferences.update({ usageSharing }),
    stale: [queries.me.queryKey()],
    onSaved,
  });
}

export function UsageSharingStep({ onDone }: { onDone: () => void }) {
  const { t } = useLingui();
  const id = useId();
  const [shared, setShared] = useState(false);
  const save = useSaveUsageSharing(onDone);
  return (
    <form
      className="flex flex-col items-center"
      data-testid="usage-sharing-step"
      onSubmit={(event) => {
        event.preventDefault();
        save.run(shared);
      }}
    >
      <img src="/icon-192.png" alt="" width={74} height={74} className="rounded-[22%]" />
      <h1 className="mt-7 text-balance text-center text-display font-medium tracking-tight text-foreground">
        <Trans>Enable data sharing</Trans>
      </h1>
      <p className="mt-2 text-center text-body text-muted-foreground">
        <Trans>Help make RoBots better for everyone</Trans>
      </p>
      <div className="mt-8 w-full rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={id} className="text-body font-medium text-foreground">
            <Trans>Share data</Trans>
          </label>
          <Switch id={id} checked={shared} onCheckedChange={setShared} disabled={save.pending} />
        </div>
        <p className="mt-3 text-body-sm text-muted-foreground">
          <Trans>
            Share how you use RoBots, like which screens you open and whether a task finishes. Your
            messages, files and memory are never included. Crash reports are sent either way. You
            can change this anytime in Settings.
          </Trans>
        </p>
      </div>
      <Button type="submit" className="mt-6 w-full" disabled={save.pending}>
        <Trans>Continue</Trans>
      </Button>
      {save.error ? (
        <p role="alert" className="mt-3 text-body-sm text-destructive">
          {errorText(save.error, t`Could not save your choice`)}
        </p>
      ) : null}
      <p className="mt-6 text-center text-body-sm text-muted-foreground">
        <Trans>
          Learn more in our{" "}
          <a
            href={AI_PRIVACY_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Privacy Policy
          </a>
          .
        </Trans>
      </p>
    </form>
  );
}

export function UsageSharingSetting() {
  const { t } = useLingui();
  const id = useId();
  const queries = useSpaceQueries();
  const sharing = useQuery(queries.me.queryOptions()).data?.usageSharing;
  const save = useSaveUsageSharing();
  if (!sharing?.available) return null;
  return (
    <SettingsGroup data-testid="settings-usage-sharing">
      <SettingsRow
        label={
          <>
            <Label htmlFor={id} className="text-body font-normal text-foreground">
              <Trans>Share usage data</Trans>
            </Label>
            <p id={`${id}-description`} className="mt-0.5 text-body-sm text-muted-foreground">
              <Trans>
                Help improve RoBots with how you use it, never your messages or files. Crash reports
                are sent either way.
              </Trans>
            </p>
          </>
        }
        control={
          <Switch
            id={id}
            aria-describedby={`${id}-description`}
            data-testid="usage-sharing-toggle"
            checked={save.pending ? Boolean(save.input) : sharing.enabled}
            disabled={save.pending}
            onCheckedChange={(next) => save.run(next)}
          />
        }
      >
        {save.error ? (
          <p role="alert" className="mt-2 text-body-sm text-destructive">
            {errorText(save.error, t`Could not save your choice`)}
          </p>
        ) : null}
      </SettingsRow>
    </SettingsGroup>
  );
}
