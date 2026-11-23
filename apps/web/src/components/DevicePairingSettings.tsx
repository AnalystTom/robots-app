import { Trans, useLingui } from "@lingui/react/macro";
import type { PairedDevice, PairingCode } from "@robots/contracts";
import { formatPairingCode, PAIRING_CODE_TTL_MS, pairingLink } from "@robots/contracts";
import { Button, Input } from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCopyText } from "../lib/copy-text";
import { pairedDeviceLabel, pairingOrigins, pairingQr } from "../lib/device-pairing";
import { useSave, useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { errorText } from "../lib/user-error";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

/**
 * Signs the account in on another device with a one-time code, and lists the devices signed in
 * that way. `sharedUrls` are the addresses the desktop app opened to the network; a browser
 * uses its own.
 */
export function DevicePairingSettings({ sharedUrls = [] }: { sharedUrls?: readonly string[] }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const devicesKey = queries.devicePairing.devices.queryKey();
  const devices = useQuery(queries.devicePairing.devices.queryOptions());
  const [grant, setGrant] = useState<PairingCode | null>(null);
  const [confirm, setConfirm] = useState<PairedDevice | "others" | null>(null);
  const create = useSave({
    save: (_input, rpc) => rpc.devicePairing.create(),
    onSaved: (created) => setGrant(created),
  });
  const revoke = useSave<PairedDevice | "others">({
    save: async (target, rpc) => {
      if (target === "others") await rpc.devicePairing.revokeOthers();
      else await rpc.devicePairing.revoke({ id: target.id });
    },
    stale: [devicesKey],
    onSaved: () => setConfirm(null),
  });
  const others = (devices.data ?? []).filter((device) => !device.current);
  // A device that paired since the code was made spent it, most likely this one.
  const spent =
    grant &&
    devices.data?.some(
      (device) => Date.parse(device.pairedAt) >= Date.parse(grant.expiresAt) - PAIRING_CODE_TTL_MS,
    );
  return (
    <>
      <SettingsGroup title={<Trans>Pair a device</Trans>} data-testid="device-pairing">
        <SettingsRow
          label={<Trans>Sign in on a phone, tablet or another computer</Trans>}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={create.pending}
              onClick={() => create.run()}
            >
              {grant ? <Trans>New code</Trans> : <Trans>Create code</Trans>}
            </Button>
          }
        >
          {create.error ? (
            <p role="alert" className="mt-2 text-body-sm text-destructive">
              {errorText(create.error)}
            </p>
          ) : null}
        </SettingsRow>
        {grant && !spent ? (
          <PairingGrant
            grant={grant}
            origins={pairingOrigins(sharedUrls)}
            onExpired={() => setGrant(null)}
          />
        ) : null}
      </SettingsGroup>
      {others.length || devices.data?.some((device) => device.current) ? (
        <SettingsGroup
          title={<Trans>Paired devices</Trans>}
          action={
            others.length > 1 ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirm("others")}>
                <Trans>Sign out all</Trans>
              </Button>
            ) : null
          }
          data-testid="paired-devices"
        >
          {(devices.data ?? []).map((device) => (
            <SettingsRow
              key={device.id}
              label={
                <span className="flex flex-col">
                  <span>
                    {pairedDeviceLabel(device)}
                    {device.current ? (
                      <span className="ml-2 text-body-sm text-muted-foreground">
                        <Trans>This device</Trans>
                      </span>
                    ) : null}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {[formatRelativeTime(device.lastSeenAt), device.ipAddress]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              }
              control={
                device.current ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={t`Sign out ${pairedDeviceLabel(device)}`}
                    onClick={() => setConfirm(device)}
                  >
                    <Trans>Sign out</Trans>
                  </Button>
                )
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={
            confirm === "others"
              ? t`Sign out all other paired devices?`
              : t`Sign out "${pairedDeviceLabel(confirm)}"?`
          }
          description={<Trans>Pair it again with a new code to sign back in.</Trans>}
          error={revoke.error ? errorText(revoke.error) : null}
          busy={revoke.pending}
          onCancel={() => {
            setConfirm(null);
            revoke.reset();
          }}
          onConfirm={() => revoke.run(confirm)}
          confirmLabel={<Trans>Sign out</Trans>}
        />
      ) : null}
    </>
  );
}

function PairingGrant({
  grant,
  origins,
  onExpired,
}: {
  grant: PairingCode;
  origins: readonly string[];
  onExpired: () => void;
}) {
  const { t } = useLingui();
  const [copied, copy] = useCopyText();
  const [origin, setOrigin] = useState(origins[0] ?? null);
  const left = useSecondsLeft(grant.expiresAt);
  useEffect(() => {
    if (left <= 0) onExpired();
  }, [left, onExpired]);
  const link = origin ? pairingLink(origin, grant.code) : null;
  const qr = link ? pairingQr(link) : null;
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return (
    <div className="flex flex-wrap items-start gap-6 px-4 py-4">
      {qr ? (
        // Scanners read dark modules on a light ground, so the code keeps them in either theme.
        <svg
          role="img"
          aria-label={t`Pairing QR code`}
          viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
          className="size-44 shrink-0 rounded-lg bg-white text-black"
          shapeRendering="crispEdges"
        >
          <path d={qr.path} fill="currentColor" />
        </svg>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-mono text-heading tracking-widest" data-testid="pairing-code">
          {formatPairingCode(grant.code)}
        </p>
        {origins.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {origins.map((candidate) => (
              <Button
                key={candidate}
                size="xs"
                variant={candidate === origin ? "secondary" : "ghost"}
                onClick={() => setOrigin(candidate)}
              >
                {new URL(candidate).host}
              </Button>
            ))}
          </div>
        ) : null}
        {link ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={link}
              aria-label={t`Pairing link`}
              onFocus={(event) => event.target.select()}
              className="h-8 flex-1 font-mono text-body-sm"
            />
            <Button size="sm" variant="secondary" onClick={() => void copy(link)}>
              {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
            </Button>
          </div>
        ) : (
          <p className="text-body-sm text-muted-foreground">
            <Trans>
              On the other device, open this server's address and choose Pair with a code.
            </Trans>
          </p>
        )}
        <p className="text-body-sm text-muted-foreground" role="timer">
          <Trans>
            Works once. Expires in {minutes}:{seconds}.
          </Trans>
        </p>
      </div>
    </div>
  );
}

/** Seconds until `at`, ticking each second while shown: a clock, not a data read. */
function useSecondsLeft(at: string): number {
  const end = new Date(at).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((end - now) / 1_000));
}
