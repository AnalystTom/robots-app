import { t } from "@lingui/core/macro";
import { resolveSelectableModelId } from "@robots/core";
import { useQuery } from "@tanstack/react-query";
import type { MobileBot } from "./mobile-types";
import { queryClient, rpcQuery } from "./query";

type ModelledBot = Pick<MobileBot, "spaceId" | "modelProvider" | "modelId">;

export function useBotModelLabel(bot: ModelledBot | undefined): string {
  const modelId = bot?.modelId ?? null;
  const catalog =
    useQuery(
      { ...rpcQuery("models/list", undefined, bot?.spaceId), enabled: modelId !== null },
      queryClient,
    ).data ?? [];
  if (!modelId) return t`Auto`;
  const provider = bot?.modelProvider ?? "";
  const resolvedId = resolveSelectableModelId(catalog, provider, modelId);
  return (
    catalog.find((entry) => entry.provider === provider && entry.id === resolvedId)?.label ??
    modelId
  );
}
