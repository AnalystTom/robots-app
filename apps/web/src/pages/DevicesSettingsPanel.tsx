import { Trans, useLingui } from "@lingui/react/macro";
import type { DesktopNetworkMode, DesktopNetworkState } from "@robots/contracts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@robots/ui-web";
import { useEffect, useState } from "react";
import { DevicePairingSettings } from "../components/DevicePairingSettings";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { desktopBridge } from "../lib/desktop";
import { useSave } from "../lib/query";
import { errorText } from "../lib/user-error";

/** Pairing other devices, and in the desktop app, who on the network can reach this computer. */
export function DevicesSettingsPanel() {
  const network = useDesktopNetwork();
  return (
    <>
      {network.state ? <NetworkAccess {...network} state={network.state} /> : null}
      <DevicePairingSettings sharedUrls={network.state?.urls ?? []} />
    </>
  );
}

/** The desktop app's network state, read once when the page opens. */
function useDesktopNetwork() {
  const bridge = desktopBridge()?.network;
  const [state, setState] = useState<DesktopNetworkState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    bridge.state().then(
      (next) => {
        if (active) setState(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [bridge]);
  return { bridge, state, setState };
}

function NetworkAccess({
  bridge,
  state,
  setState,
}: ReturnType<typeof useDesktopNetwork> & { state: DesktopNetworkState }) {
  const { t } = useLingui();
  const change = useSave<DesktopNetworkMode, DesktopNetworkState | null>({
    save: async (mode) => (await bridge?.setMode(mode)) ?? null,
    onSaved: (next) => {
      if (next) setState(next);
    },
  });
  const labels: Record<DesktopNetworkMode, string> = {
    off: t`Only this computer`,
    local: t`Local network`,
    "private-https": t`Private network (HTTPS)`,
  };
  const reasons: Record<string, string> = {
    missing: t`Install and sign in to your private network on this computer first.`,
    stopped: t`Connect this computer to your private network first.`,
    "no-https": t`Turn on HTTPS names for your private network first.`,
    "in-use": t`Your private network's HTTPS address already serves something else.`,
  };
  const failure = change.error
    ? errorText(change.error)
    : state.error
      ? (reasons[state.error] ?? t`Could not change network access.`)
      : null;
  return (
    <SettingsGroup title={<Trans>Network access</Trans>} data-testid="network-access">
      <SettingsRow
        label={<Trans>Who can open RoBots</Trans>}
        control={
          <Select
            value={change.pending && change.input ? change.input : state.mode}
            onValueChange={(value) => {
              if (value && value !== state.mode) change.run(value as DesktopNetworkMode);
            }}
            items={state.available.map((mode) => ({ value: mode, label: labels[mode] }))}
          >
            <SelectTrigger
              aria-label={t`Who can open RoBots`}
              className="w-56"
              disabled={change.pending}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end">
              <SelectGroup>
                {state.available.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {labels[mode]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      >
        {change.pending ? (
          <p className="mt-2 text-body-sm text-muted-foreground" role="status">
            <Trans>Restarting…</Trans>
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="mt-2 text-body-sm text-destructive">
            {failure}
          </p>
        ) : null}
        {state.urls.length ? (
          <ul className="mt-2 text-body-sm text-muted-foreground">
            {state.urls.map((url) => (
              <li key={url} className="font-mono break-all">
                {url}
              </li>
            ))}
          </ul>
        ) : null}
      </SettingsRow>
    </SettingsGroup>
  );
}
