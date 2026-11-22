import { Trans, useLingui } from "@lingui/react/macro";
import type {
  BrowserProfileSummary,
  ImportSessionsResult,
  RobotsDesktop,
  SessionDelivery,
  SettingsScope,
} from "@robots/contracts";
import { Button, Checkbox, NativeSelect } from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { useVaultBots } from "./VaultItemAccess";

type BrowserSessions = NonNullable<RobotsDesktop["browserSessions"]>;

class ReadRefused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function toggled(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

export function VaultSessionImportPage({
  scope,
  browserSessions,
  onBack,
  onImported,
}: {
  scope: SettingsScope;
  browserSessions: BrowserSessions;
  onBack: () => void;
  onImported: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const profiles = useQuery({
    queryKey: ["desktop", "browser-profiles"],
    queryFn: async () => (await browserSessions.profiles()) ?? [],
    staleTime: 0,
  });
  const bots = useVaultBots(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [sites, setSites] = useState<ReadonlySet<string>>(new Set());
  const [botIds, setBotIds] = useState<ReadonlySet<string> | null>(null);
  const [result, setResult] = useState<ImportSessionsResult | null>(null);

  const list: BrowserProfileSummary[] = profiles.data ?? [];
  const profile = list.find((entry) => entry.id === profileId) ?? list[0];
  const activeBots = (bots ?? []).filter((bot) => !bot.archivedAt);
  const chosenBots = botIds ?? new Set(activeBots.length === 1 ? [activeBots[0]!.id] : []);

  const refusals: Record<string, string> = {
    unsupported_encryption: t`This browser locks its sign-ins to itself, so they can't be imported.`,
    key_unavailable: t`RoBots couldn't find this browser's key on this computer.`,
    key_locked: t`Unlock your keyring, then try again.`,
    key_denied: t`Allow RoBots to use the browser's key when your computer asks, then try again.`,
    wrong_key: t`This browser's key didn't open its sign-ins.`,
    profile_busy: t`Close the browser, then try again.`,
    profile_not_found: t`That browser profile is gone.`,
  };

  const importing = useSave({
    save: async (
      input: { profile: BrowserProfileSummary; sites: string[]; botIds: string[] },
      rpc,
    ) => {
      const read = await browserSessions.read(input.profile.id, input.sites);
      if (!read) throw new ReadRefused("profile_not_found");
      if (!read.ok) throw new ReadRefused(read.code);
      if (!read.sessions.length) throw new ReadRefused("empty");
      return rpc.vault.importSessions({
        scope,
        source: t`${input.profile.name} in ${input.profile.browser}`,
        botIds: input.botIds,
        sessions: read.sessions,
      });
    },
    stale: [queries.vault.list.queryKey({ input: { scope } })],
    onSaved: (saved) => {
      setResult(saved);
      onImported();
    },
  });

  const failure = !importing.error
    ? null
    : !(importing.error instanceof ReadRefused)
      ? errorText(importing.error, t`Could not import sign-ins`)
      : importing.error.code === "cancelled"
        ? null
        : (refusals[importing.error.code] ?? t`Nothing to import from those sites.`);

  const delivery: Record<SessionDelivery, string> = {
    pending: t`Signing in…`,
    signed_in: t`Signed in`,
    next_start: t`Signs in when its computer starts`,
    failed: t`Signs in when its computer next starts`,
  };
  const botName = (id: string) => activeBots.find((bot) => bot.id === id)?.name ?? id;

  if (result)
    return (
      <div data-testid="vault-session-import" className="space-y-4">
        <SettingsPageHeader title={t`Import browser sign-ins`} onBack={onBack} />
        <ul className="overflow-hidden rounded-xl bg-muted/50">
          {result.bots.map((bot) => (
            <li
              key={bot.botId}
              data-testid="vault-session-delivery"
              className="flex justify-between gap-3 border-t border-border px-3.5 py-2.5 text-body first:border-t-0"
            >
              <span className="truncate">{botName(bot.botId)}</span>
              <span className="shrink-0 text-muted-foreground">{delivery[bot.delivery]}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button size="sm" onClick={onBack}>
            <Trans>Done</Trans>
          </Button>
        </div>
      </div>
    );

  const ready = Boolean(profile) && sites.size > 0 && chosenBots.size > 0 && !profile?.busy;
  return (
    <div data-testid="vault-session-import" className="space-y-4">
      <SettingsPageHeader
        title={t`Import browser sign-ins`}
        onBack={() => !importing.pending && onBack()}
      />
      {profiles.isPending ? null : list.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          <Trans>No browser sign-ins found on this computer.</Trans>
        </p>
      ) : (
        <>
          {list.length > 1 ? (
            <NativeSelect
              aria-label={t`Browser profile`}
              data-testid="vault-session-profile"
              value={profile?.id}
              disabled={importing.pending}
              onChange={(event) => {
                setProfileId(event.target.value);
                setSites(new Set());
                importing.reset();
              }}
            >
              {list.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t`${entry.name} in ${entry.browser}`}
                </option>
              ))}
            </NativeSelect>
          ) : profile ? (
            <p className="text-body text-foreground">{t`${profile.name} in ${profile.browser}`}</p>
          ) : null}
          {profile?.busy ? (
            <p className="text-body-sm text-muted-foreground">{refusals.profile_busy}</p>
          ) : (
            <ul
              aria-label={t`Sites`}
              className="max-h-80 overflow-y-auto overflow-x-hidden rounded-xl bg-muted/50"
            >
              {profile?.sites.map((entry) => (
                <li key={entry.site} className="border-t border-border first:border-t-0">
                  <div className="flex items-center gap-3 px-3.5 py-2.5 text-body">
                    <Checkbox
                      aria-label={entry.site}
                      data-testid="vault-session-site"
                      data-site={entry.site}
                      checked={sites.has(entry.site)}
                      disabled={importing.pending}
                      onCheckedChange={() => {
                        setSites((now) => toggled(now, entry.site));
                        importing.reset();
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.site}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activeBots.length > 1 ? (
            <fieldset className="m-0 space-y-1 border-0 p-0">
              <legend className="pb-1 text-body-sm text-muted-foreground">
                <Trans>Bots</Trans>
              </legend>
              {activeBots.map((bot) => (
                <div key={bot.id} className="flex items-center gap-3 py-1 text-body">
                  <Checkbox
                    aria-label={bot.name}
                    data-testid="vault-session-bot"
                    checked={chosenBots.has(bot.id)}
                    disabled={importing.pending}
                    onCheckedChange={() => setBotIds(toggled(chosenBots, bot.id))}
                  />
                  <span className="truncate">{bot.name}</span>
                </div>
              ))}
            </fieldset>
          ) : null}
        </>
      )}
      {failure ? (
        <p role="alert" className="text-body-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          size="sm"
          data-testid="vault-session-import-submit"
          disabled={!ready || importing.pending}
          onClick={() =>
            profile && importing.run({ profile, sites: [...sites], botIds: [...chosenBots] })
          }
        >
          {importing.pending ? <Trans>Importing…</Trans> : <Trans>Import</Trans>}
        </Button>
      </div>
    </div>
  );
}
