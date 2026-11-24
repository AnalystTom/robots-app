import * as z from "zod";

export const SkillSafetyRuleSchema = z.enum([
  "download_and_run",
  "decode_and_run",
  "credential_exfiltration",
  "credential_access",
  "destructive_command",
  "instruction_override",
  "hidden_comment",
  "encoded_blob",
  "bidi_unicode",
  "tag_unicode",
  "zero_width_unicode",
]);
export type SkillSafetyRule = z.infer<typeof SkillSafetyRuleSchema>;

export const SkillSafetySeveritySchema = z.enum(["high", "low"]);
export type SkillSafetySeverity = z.infer<typeof SkillSafetySeveritySchema>;

export const SkillSafetyFindingSchema = z.object({
  rule: SkillSafetyRuleSchema,
  severity: SkillSafetySeveritySchema,
  line: z.number().int().positive(),
  reason: z.string(),
});
export type SkillSafetyFinding = z.infer<typeof SkillSafetyFindingSchema>;

export const SKILL_SAFETY_BLOCKED_REASON = "skill_unsafe";

export const SkillSafetyBlockSchema = z.object({
  reason: z.literal(SKILL_SAFETY_BLOCKED_REASON),
  skills: z.array(z.object({ name: z.string(), findings: z.array(SkillSafetyFindingSchema) })),
});
export type SkillSafetyBlock = z.infer<typeof SkillSafetyBlockSchema>;

export function skillSafetyBlock(error: unknown): SkillSafetyBlock | null {
  const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
  const parsed = SkillSafetyBlockSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
