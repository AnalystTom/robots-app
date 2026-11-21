import type { ModelTier } from "@robots/contracts";
import { canonicalPiProviderId } from "@robots/contracts";
import type { ChatModelChoice } from "./model-providers.js";
import { modelOptionKey, parseModelOptionKey } from "./model-providers.js";

export const MODEL_TIERS: readonly ModelTier[] = ["lite", "auto", "pro"];

type TierCatalogEntry = { provider: string; id: string; tier?: ModelTier };

export type ModelTierMenuInput = {
  choices: readonly ChatModelChoice[];
  catalog: readonly TierCatalogEntry[];
  defaultProvider: string | null | undefined;
  selectedKey: string;
};

export type ModelTierMenu = {
  provider: string | null;
  tier: ModelTier | null;
  selectedKey: string;
  providers: { provider: string; label: string }[];
  models: ChatModelChoice[];
  keyFor: (tier: ModelTier, provider?: string) => string;
};

function sameProvider(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && canonicalPiProviderId(left) === canonicalPiProviderId(right));
}

export function modelTierMenu(input: ModelTierMenuInput): ModelTierMenu {
  const connected = input.choices.filter((choice) => choice.key && choice.provider);
  const providers: { provider: string; label: string }[] = [];
  for (const choice of connected) {
    if (providers.some((entry) => sameProvider(entry.provider, choice.provider))) continue;
    providers.push({
      provider: canonicalPiProviderId(choice.provider!),
      label: choice.providerLabel ?? choice.provider!,
    });
  }
  const modelsOf = (provider: string | null) =>
    connected.filter((choice) => sameProvider(choice.provider, provider));
  const tierKey = (provider: string, tier: ModelTier) => {
    const offered = new Set(modelsOf(provider).map((choice) => choice.key));
    const keyOf = (wanted: ModelTier) =>
      input.catalog
        .filter((entry) => entry.tier === wanted && sameProvider(entry.provider, provider))
        .map((entry) => modelOptionKey(entry.provider, entry.id))
        .find((key) => offered.has(key));
    return keyOf(tier) ?? keyOf("auto") ?? modelsOf(provider)[0]?.key ?? "";
  };
  const defaultProvider = input.defaultProvider
    ? canonicalPiProviderId(input.defaultProvider)
    : (providers[0]?.provider ?? null);
  const keyFor = (tier: ModelTier, provider = defaultProvider ?? "") =>
    tier === "auto" && sameProvider(provider, defaultProvider) ? "" : tierKey(provider, tier);
  const selected = input.selectedKey ? parseModelOptionKey(input.selectedKey) : null;
  const provider = selected?.provider ?? defaultProvider;
  const tier = input.selectedKey
    ? ((["auto", "lite", "pro"] as const).find(
        (candidate) => provider && keyFor(candidate, provider) === input.selectedKey,
      ) ?? null)
    : "auto";
  return {
    provider,
    tier,
    selectedKey: input.selectedKey,
    providers,
    models: modelsOf(provider),
    keyFor,
  };
}
