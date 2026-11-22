import { Trans, useLingui } from "@lingui/react/macro";
import type { BotAvatarSet } from "@robots/contracts";
import { BOT_NAME_MAX_LENGTH } from "@robots/contracts";
import {
  botLookState,
  newBotLook,
  newBotLookColor,
  newBotLookForSet,
  newBotLookInput,
  newBotPreviewIdentity,
  ORGANIC_PREVIEW_IDENTITIES,
  robotPresetOf,
  robotPresetValue,
} from "@robots/core";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@robots/ui-web";
import { useRef, useState } from "react";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";
import { RobotPresetPicker } from "./robot-presets";

export interface CreateBotDialogInput {
  name: string;
  color?: string;
  id?: string;
  avatarFamily?: number;
  avatarSet?: BotAvatarSet;
}

export function CreateBotDialog({
  avatarSet,
  ownBotColors,
  onCancel,
  onCreate,
}: {
  avatarSet: BotAvatarSet;
  ownBotColors: readonly string[];
  onCancel: () => void;
  onCreate: (input: CreateBotDialogInput) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [look, setLook] = useState(() =>
    newBotLookForSet(newBotLook(avatarSet), avatarSet, ownBotColors),
  );
  const pickedRobot = botLookState(newBotLookColor(look)).robot;
  const identity = newBotPreviewIdentity(avatarSet, look);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({ name: trimmed, ...newBotLookInput(avatarSet, look) });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        data-testid="create-bot-dialog"
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New bot</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <BotAvatar
              color={newBotLookColor(look)}
              identity={identity}
              size={96}
              avatarSet={avatarSet}
            />
          </div>
          <Input
            ref={nameRef}
            aria-label={t`Name`}
            placeholder={t`Name your Bot`}
            value={name}
            maxLength={BOT_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            className="text-center"
          />
          {error ? (
            <p
              role="alert"
              data-testid="create-bot-error"
              className="text-body-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {avatarSet === "robots" ? (
            <RobotPresetPicker
              robot={pickedRobot}
              onChange={(color) => {
                setLook((current) => ({ ...current, color }));
              }}
            />
          ) : (
            <BotLookPicker
              value={newBotLookColor(look)}
              identity={identity}
              organicIdentities={ORGANIC_PREVIEW_IDENTITIES}
              avatarSet={avatarSet}
              onChange={(color, picked) => {
                setLook((current) => ({ ...current, color, identity: picked ?? current.identity }));
              }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!trimmed || submitting}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
