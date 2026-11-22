import { canonicalPiProviderId } from "@robots/contracts";

const FAST_MODE_PROVIDERS: ReadonlySet<string> = new Set(["openai", "openai-codex"]);

export const FAST_MODE_SERVICE_TIER = "priority";

export function supportsFastMode(provider: string | null | undefined): boolean {
  return Boolean(provider && FAST_MODE_PROVIDERS.has(canonicalPiProviderId(provider)));
}

export function fastModeServiceTier(
  fastMode: boolean | undefined,
  provider: string,
): typeof FAST_MODE_SERVICE_TIER | undefined {
  return fastMode && supportsFastMode(provider) ? FAST_MODE_SERVICE_TIER : undefined;
}
