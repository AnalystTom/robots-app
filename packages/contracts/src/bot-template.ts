import * as z from "zod";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BotSchema,
} from "./domain.js";
import { parseRobotCharacter } from "./robot-character.js";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

export const BotTemplateSchema = z.strictObject({
  id: slug,
  version: z.number().int().positive(),
  avatar: z.string().refine((value) => parseRobotCharacter(value) !== null),
  name: z.string().min(1).max(BOT_NAME_MAX_LENGTH),
  summary: z.string().min(1).max(120),
  description: z.string().max(BOT_DESCRIPTION_MAX_LENGTH),
  instructions: z.string().min(1).max(BOT_INSTRUCTIONS_MAX_LENGTH),
  skills: z
    .array(
      z.strictObject({
        name: z
          .string()
          .regex(/^[A-Za-z][\w-]*(?: [A-Za-z][\w-]*){0,5}$/)
          .max(64),
        description: z.string().min(1).max(2000),
        body: z.string().min(1).max(20_000),
      }),
    )
    .max(5),
  routines: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(80),
        prompt: z.string().min(1).max(4000),
        crons: z.array(z.string().min(1)).min(1).max(5),
      }),
    )
    .max(5),
  apps: z.array(slug).max(6),
});
export type BotTemplate = z.infer<typeof BotTemplateSchema>;

export const BotTemplateListingSchema = BotTemplateSchema.extend({
  botId: z.string().nullable(),
});
export type BotTemplateListing = z.infer<typeof BotTemplateListingSchema>;

export const CreateBotFromTemplateInput = z.strictObject({
  templateId: slug,
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH).optional(),
});

export const CreateBotTeamFromTemplateInput = z.strictObject({ teamId: slug });

export const CreateBotTeamFromTemplateOutput = z.object({
  bots: z.array(BotSchema).min(1),
  failed: z.array(slug),
});

export const CreateBotFromTemplateOutput = z.object({
  bot: BotSchema,
  created: z.boolean(),
});

export const BOT_TEMPLATE_IMPORT_KEY_PREFIX = "template:";

export const BOT_TEMPLATE_CHANGED = "template_changed";

export function isBotTemplateChanged(error: unknown): boolean {
  const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
  return Boolean(
    data && typeof data === "object" && "reason" in data && data.reason === BOT_TEMPLATE_CHANGED,
  );
}
