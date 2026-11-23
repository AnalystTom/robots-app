import { t } from "@lingui/core/macro";

export function botModelLabel(modelId: string | null | undefined): string {
  return modelId ?? t`Auto`;
}
