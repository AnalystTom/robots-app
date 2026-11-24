import type { ModelTier } from "@robots/contracts";

export type PricedModel = { provider: string; id: string; label: string; price: number };

type Release = PricedModel & { family: string; version: number[] };

const MAX_MAJOR_VERSION = 100;
const VERSION = /(?<![\w.])v?(\d+(?:\.\d+)*)(?![\w.])/;

function release(model: PricedModel): Release | undefined {
  const name = model.label.replace(/\([^)]*\)/g, " ").trim();
  const match = VERSION.exec(name) ?? VERSION.exec(name.replace(/-/g, " "));
  if (!match) return undefined;
  const family = `${name.slice(0, match.index)}#${name.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return { ...model, family, version: match[1]!.split(".").map(Number) };
}

function compareVersions(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function providerTiers(models: readonly PricedModel[]): Map<string, ModelTier> {
  const releases = models
    .filter((model) => model.price > 0)
    .flatMap((model) => release(model) ?? [])
    .filter((model) => model.version[0]! < MAX_MAJOR_VERSION);
  const latestMajor = Math.max(...releases.map((model) => model.version[0]!));
  const newestByFamily = new Map<string, Release>();
  for (const model of releases) {
    if (model.version[0] !== latestMajor) continue;
    const known = newestByFamily.get(model.family);
    if (
      !known ||
      compareVersions(model.version, known.version) > 0 ||
      (compareVersions(model.version, known.version) === 0 && model.id.length < known.id.length)
    )
      newestByFamily.set(model.family, model);
  }
  const ladder = [...newestByFamily.values()].sort(
    (left, right) => left.price - right.price || left.id.localeCompare(right.id),
  );
  const tiers = new Map<string, ModelTier>();
  if (!ladder.length) return tiers;
  tiers.set(ladder[0]!.id, "lite");
  tiers.set(ladder.at(-1)!.id, "pro");
  tiers.set(ladder[Math.floor((ladder.length - 1) / 2)]!.id, "auto");
  return tiers;
}

export function modelTiers(models: readonly PricedModel[]): Map<string, ModelTier> {
  const byProvider = new Map<string, PricedModel[]>();
  for (const model of models)
    byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  const tiers = new Map<string, ModelTier>();
  for (const [provider, list] of byProvider) {
    for (const [id, tier] of providerTiers(list)) tiers.set(`${provider}:${id}`, tier);
  }
  return tiers;
}
