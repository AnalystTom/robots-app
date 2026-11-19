import { z } from "zod";

export const LAB_FEATURES = ["board", "today", "email", "docs"] as const;
export const LabFeatureSchema = z.enum(LAB_FEATURES);
export type LabFeature = z.infer<typeof LabFeatureSchema>;

export function parseLabs(stored: readonly string[] | null | undefined): LabFeature[] {
  return LAB_FEATURES.filter((feature) => stored?.includes(feature));
}

export function resolveLabs(
  stored: readonly string[] | null | undefined,
  deployment: readonly LabFeature[] = [],
): LabFeature[] {
  return LAB_FEATURES.filter((feature) => deployment.includes(feature) || hasLab(stored, feature));
}

export function hasLab(stored: readonly string[] | null | undefined, feature: LabFeature) {
  return Boolean(stored?.includes(feature));
}

export function withLab(
  stored: readonly string[] | null | undefined,
  feature: LabFeature,
  enabled: boolean,
): LabFeature[] {
  return LAB_FEATURES.filter((lab) => (lab === feature ? enabled : hasLab(stored, lab)));
}

export const WORKSPACE_PAGES = [
  { id: "today", lab: "today", path: "/app/today" },
  { id: "tasks", lab: "board", path: "/app/tasks" },
  { id: "email", lab: "email", path: "/app/email" },
  { id: "docs", lab: "docs", path: "/app/docs" },
] as const satisfies ReadonlyArray<{ id: string; lab: LabFeature; path: string }>;
