export type UnitIntervalRandom = () => number;

export function pickLeastUsed<T>(
  options: readonly T[],
  used: readonly T[],
  random: UnitIntervalRandom,
  avoid: readonly T[] = [],
): T {
  const counts = options.map((option) => used.filter((value) => value === option).length);
  const fewest = Math.min(...counts);
  const least = options.filter((_, index) => counts[index] === fewest);
  const preferred = least.filter((option) => !avoid.includes(option));
  const candidates = preferred.length > 0 ? preferred : least;
  return candidates[Math.floor(random() * candidates.length)] ?? options[0]!;
}
