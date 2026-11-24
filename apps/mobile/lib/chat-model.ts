import { t } from "@lingui/core/macro";
import type { ChatModelChoice } from "@robots/core";
import { chatModelChoices, connectedModelChoices } from "@robots/core";
import type { MobileMe, MobileModel, MobileModelCredential } from "./mobile-types";

export function chatModelPickerChoices(
  me: MobileMe | null,
  catalog: MobileModel[],
  credentials: MobileModelCredential[],
  selectedKey: string,
): ChatModelChoice[] {
  const defaultEntry = me?.defaultModel
    ? catalogEntry(catalog, me.defaultProvider, me.defaultModel)
    : undefined;
  const defaultModelLabel = me?.defaultModel ? (defaultEntry?.label ?? me.defaultModel) : null;
  const spaceDefaultLabel = defaultModelLabel
    ? t`Space default · ${defaultModelLabel}`
    : t`Space default`;
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedKey,
    spaceDefaultLabel,
    defaultEntry?.images,
  );
  choices[0] = {
    ...choices[0]!,
    title: t`Space default`,
    detail: me?.defaultModel ? (defaultEntry?.label ?? me.defaultModel) : undefined,
  };
  return choices;
}

function catalogEntry(
  catalog: MobileModel[],
  provider: string | null | undefined,
  modelId: string,
) {
  if (!provider) return undefined;
  return catalog.find((entry) => entry.provider === provider && entry.id === modelId);
}
