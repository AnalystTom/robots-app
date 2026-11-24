import { Trans, useLingui } from "@lingui/react/macro";
import type { BotPackage } from "@robots/contracts";
import { botPackageFileName } from "@robots/core";
import { Checkbox, Label } from "@robots/ui-web";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadArtifactBytes } from "../../lib/artifact-open";
import { useSave } from "../../lib/query";
import { errorText } from "../../lib/user-error";

export function ExportBotDialog({
  bot,
  onClose,
}: {
  bot: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [includeMemory, setIncludeMemory] = useState(false);
  const exporter = useSave<boolean, BotPackage>({
    save: (memory, rpc) => rpc.bots.exportPackage({ botId: bot.id, includeMemory: memory }),
    onSaved: (pkg) => {
      downloadArtifactBytes(
        botPackageFileName(bot.name),
        "application/json",
        new TextEncoder().encode(`${JSON.stringify(pkg, null, 2)}\n`),
      );
      onClose();
    },
    closesScreen: true,
  });

  return (
    <ConfirmDialog
      variant="default"
      busy={exporter.pending}
      error={exporter.error ? errorText(exporter.error, t`Could not export bot`) : null}
      title={<Trans>Export bot</Trans>}
      confirmLabel={<Trans>Export</Trans>}
      onCancel={onClose}
      onConfirm={() => exporter.run(includeMemory)}
    >
      <Label
        data-testid="export-bot-memory"
        className="min-h-9 gap-3 font-normal text-body text-foreground"
      >
        <Checkbox
          checked={includeMemory}
          disabled={exporter.pending}
          onCheckedChange={(checked) => setIncludeMemory(checked)}
        />
        <Trans>Include memory notes</Trans>
      </Label>
    </ConfirmDialog>
  );
}
