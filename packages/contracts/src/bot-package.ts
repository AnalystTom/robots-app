import * as z from "zod";
import { BotAvatarSetSchema, BotAvatarValueSchema } from "./bot-avatar.js";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  TimeZoneSchema,
} from "./domain.js";
import { Id } from "./ids.js";

export const BOT_PACKAGE_FORMAT = "robots.bot-package";
export const BOT_PACKAGE_VERSION = 1;
export const BOT_PACKAGE_FILE_EXTENSION = ".robot.json";
export const BOT_PACKAGE_PATH = "robots-bot-package.json";
export const BOT_PACKAGE_MAX_LENGTH = 2_000_000;
export const BOT_PACKAGE_TEXT_MAX_LENGTH = 100_000;

const MEMORY_PATH = /^(?![/.])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\0\\]{1,300}\.md$/i;

export const BotPackageSkillSchema = z.strictObject({
  content: z.string().min(1).max(BOT_PACKAGE_TEXT_MAX_LENGTH),
});

export const BotPackageRoutineSchema = z.strictObject({
  name: z.string().min(1).max(80),
  prompt: z.string().min(1).max(BOT_PACKAGE_TEXT_MAX_LENGTH),
  crons: z.array(z.string().min(1).max(200)).min(1).max(5),
  timezone: TimeZoneSchema,
});

export const BotPackageMemorySchema = z.strictObject({
  path: z.string().regex(MEMORY_PATH),
  content: z.string().max(BOT_PACKAGE_TEXT_MAX_LENGTH),
});

export const BotPackageModelSchema = z.strictObject({
  provider: z.string().min(1).max(80),
  modelId: z.string().min(1).max(200),
});

export const BotPackageSchema = z.strictObject({
  format: z.literal(BOT_PACKAGE_FORMAT),
  version: z.literal(BOT_PACKAGE_VERSION),
  exportedAt: z.iso.datetime(),
  bot: z.strictObject({
    name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
    description: z.string().max(BOT_DESCRIPTION_MAX_LENGTH),
    instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH),
    color: BotAvatarValueSchema,
    avatarSet: BotAvatarSetSchema,
    model: BotPackageModelSchema.nullable(),
  }),
  skills: z.array(BotPackageSkillSchema).max(200),
  routines: z.array(BotPackageRoutineSchema).max(100),
  memory: z.array(BotPackageMemorySchema).max(500),
});
export type BotPackage = z.infer<typeof BotPackageSchema>;

export const ExportBotPackageInput = z.strictObject({
  botId: Id,
  includeMemory: z.boolean().default(false),
});
