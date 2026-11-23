import * as z from "zod";

export const ACTION_RULE_INITIATORS = ["you", "routine", "webhook", "chat_app", "bot"] as const;
export const ActionRuleInitiatorSchema = z.enum(ACTION_RULE_INITIATORS);
export type ActionRuleInitiator = z.infer<typeof ActionRuleInitiatorSchema>;
export type ActionInitiator = ActionRuleInitiator | "other";

export const ACTION_RULE_EFFECTS = ["allow", "ask", "deny"] as const;
export const ActionRuleEffectSchema = z.enum(ACTION_RULE_EFFECTS);
export type ActionRuleEffect = z.infer<typeof ActionRuleEffectSchema>;

export const ACTION_RULE_CATEGORIES = ["email", "purchase"] as const;
export const ACTION_RULE_MATCH_KINDS = ["tool", "connector", "category"] as const;
export const ACTION_RULES_MAX = 100;

const ruleFields = {
  id: z.string().min(1).max(64),
  initiator: ActionRuleInitiatorSchema.nullable(),
  effect: ActionRuleEffectSchema,
};

export const ActionRuleSchema = z.discriminatedUnion("matchKind", [
  z.object({
    ...ruleFields,
    matchKind: z.literal("tool"),
    matchValue: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.:*-]+$/),
  }),
  z.object({
    ...ruleFields,
    matchKind: z.literal("connector"),
    matchValue: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
  z.object({
    ...ruleFields,
    matchKind: z.literal("category"),
    matchValue: z.enum(ACTION_RULE_CATEGORIES),
  }),
]);
export type ActionRule = z.infer<typeof ActionRuleSchema>;

export const ActionRuleListSchema = z
  .array(ActionRuleSchema)
  .max(ACTION_RULES_MAX)
  .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, {
    message: "Each rule needs its own id.",
  });
