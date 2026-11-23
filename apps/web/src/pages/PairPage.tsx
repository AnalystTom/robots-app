import { Trans, useLingui } from "@lingui/react/macro";
import { formatPairingCode, parsePairingInput } from "@robots/contracts";
import { Button, Input, Label } from "@robots/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { exchangePairingCode, takePairingCode } from "../lib/device-pairing";
import { useSave } from "../lib/query";
import { errorText } from "../lib/user-error";
import { AuthFrame, submitClass } from "./Auth";

/**
 * Signs this device in with a code another signed-in device created. Opened from a pairing
 * link, the code is already filled in and spent at once; typed, it is spent on submit.
 */
export function PairPage({ onPaired = enterApp }: { onPaired?: () => void }) {
  const { t } = useLingui();
  const fieldId = useId();
  const [code, setCode] = useState("");
  const pair = useSave<string>({
    save: (value) => exchangePairingCode(value),
    onSaved: onPaired,
    closesScreen: true,
  });
  const linked = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Strict mode runs effects twice; a code from the link is spent once.
    if (linked.current !== undefined) return;
    linked.current = takePairingCode();
    if (!linked.current) return;
    setCode(formatPairingCode(linked.current));
    pair.run(linked.current);
  }, [pair]);
  const parsed = parsePairingInput(code);
  return (
    <AuthFrame
      title={<Trans>Pair this device</Trans>}
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed) pair.run(parsed.code);
      }}
    >
      <div className="w-full">
        <Label htmlFor={fieldId} className="text-muted-foreground">
          <Trans>Pairing code</Trans>
        </Label>
        <Input
          id={fieldId}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            pair.reset();
          }}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          className="mt-2 h-12 font-mono tracking-widest"
        />
      </div>
      {pair.error ? (
        <p role="alert" className="mt-3 w-full text-body text-destructive">
          {errorText(pair.error, t`Could not pair this device`)}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pair.pending || !parsed} className={submitClass}>
        {pair.pending ? <Trans>Pairing…</Trans> : <Trans>Pair</Trans>}
      </Button>
    </AuthFrame>
  );
}

/** A full load, so the app starts over with the new session. */
function enterApp() {
  window.location.replace("/app");
}
