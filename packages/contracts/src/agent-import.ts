import * as z from "zod";
import { AgentImportStatusSchema } from "./agent-import-setup.js";
import { BotAvatarSetSchema, BotAvatarValueSchema } from "./bot-avatar.js";
import { BOT_PACKAGE_MAX_LENGTH, BOT_PACKAGE_PATH } from "./bot-package.js";
import { BOT_TEMPLATE_IMPORT_KEY_PREFIX } from "./bot-template.js";
import { ComputerModeSchema } from "./computer.js";
import { BOT_DESCRIPTION_MAX_LENGTH, BOT_NAME_MAX_LENGTH } from "./domain.js";
import { SkillSafetyFindingSchema } from "./skill-safety.js";

export const AGENT_IMPORT_MAX_FILES = 500;
export const AGENT_IMPORT_MAX_FILE_LENGTH = 100_000;
export const AGENT_IMPORT_MAX_TOTAL_LENGTH = 4_000_000;
export const AGENT_IMPORT_MAX_PATH_LENGTH = 300;
export const GROK_BOT_EXPORT_PATH = "grok-bot-export.json";
export const GROK_BOT_EXPORT_MAX_LENGTH = 1_000_000;

const SINGLE_FILE_LIMITS: ReadonlyMap<string, number> = new Map([
  [GROK_BOT_EXPORT_PATH, GROK_BOT_EXPORT_MAX_LENGTH],
  [BOT_PACKAGE_PATH, BOT_PACKAGE_MAX_LENGTH],
]);

const AGENT_IMPORT_CONFIG_PATH =
  /^(?:[^/]+\/)?(?:openclaw\.json|\.env|config\.yaml|auth\.json|cron\/jobs\.json|skills\/\.bundled_manifest)$/;

export function isAgentImportPath(path: string): boolean {
  if (SINGLE_FILE_LIMITS.has(path)) return true;
  if (!path.toLowerCase().endsWith(".md") && !AGENT_IMPORT_CONFIG_PATH.test(path)) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export const AgentImportFileSchema = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .max(AGENT_IMPORT_MAX_PATH_LENGTH)
      .refine(
        isAgentImportPath,
        "Only relative Markdown and agent settings files can be imported.",
      ),
    content: z.string().max(Math.max(...SINGLE_FILE_LIMITS.values())),
  })
  .superRefine((file, ctx) => {
    if (file.content.length > (SINGLE_FILE_LIMITS.get(file.path) ?? AGENT_IMPORT_MAX_FILE_LENGTH)) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "The file is too large to import.",
      });
    }
  });
export type AgentImportFile = z.infer<typeof AgentImportFileSchema>;

export const AgentImportFilesSchema = z
  .array(AgentImportFileSchema)
  .min(1)
  .max(AGENT_IMPORT_MAX_FILES)
  .superRefine((files, ctx) => {
    const total = files.reduce((sum, file) => sum + file.content.length, 0);
    if (total > AGENT_IMPORT_MAX_TOTAL_LENGTH) {
      ctx.addIssue({ code: "custom", message: "The files are too large to import." });
    }
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      ctx.addIssue({ code: "custom", message: "Each file can be sent once." });
    }
  });

export const AgentImportSourceSchema = z.enum([
  "openclaw",
  "hermes",
  "document",
  "template",
  "grok_bot",
  "robots_package",
]);
export type AgentImportSource = z.infer<typeof AgentImportSourceSchema>;

export const AgentImportWarningSchema = z.enum([
  "needs_setup",
  "bundled_files",
  "runs_code",
  "unsupported_command",
  "local_path",
  "dropped_settings",
  "changed_schedule",
]);
export type AgentImportWarning = z.infer<typeof AgentImportWarningSchema>;
const warnings = z.array(AgentImportWarningSchema).default([]);

const status = AgentImportStatusSchema.default({ kind: "ready" });

export const AgentImportInstructionRoleSchema = z.enum(["persona", "working"]);

const stock = z.boolean().default(false);
const containsKey = z.boolean().optional();

export const AgentImportInstructionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  role: AgentImportInstructionRoleSchema.default("working"),
  stock,
  containsKey,
  mentions: z.array(z.string()).default([]),
});
export type AgentImportInstruction = z.infer<typeof AgentImportInstructionSchema>;

export const AgentImportMemorySchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  path: z.string(),
  spacePath: z.string(),
  stock,
  containsKey,
});
export type AgentImportMemory = z.infer<typeof AgentImportMemorySchema>;

export const AgentImportSkillSchema = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  warnings,
  status,
  containsKey,
  safety: z.array(SkillSafetyFindingSchema).default([]),
});
export type AgentImportSkill = z.infer<typeof AgentImportSkillSchema>;

export const AgentImportModelSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  providerName: z.string().optional(),
  modelId: z.string(),
  status: z.enum(["ready", "needs_key", "unknown"]),
});

export const AgentImportMcpServerSchema = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  content: z.string(),
  warnings,
  status,
});

export const AgentImportRoutineSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  warnings,
  status,
});

export const AgentImportApiKeySchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
});

export const AgentImportSkipReasonSchema = z.enum([
  "runtime",
  "invalid_skill",
  "builtin",
  "unsupported",
  "connected",
  "invalid_file",
  "default",
  "reconnect",
]);
export type AgentImportSkipReason = z.infer<typeof AgentImportSkipReasonSchema>;

export const AgentImportPlanSchema = z.object({
  source: AgentImportSourceSchema,
  suggestedName: z.string(),
  suggestedDescription: z.string().default(""),
  instructions: z.array(AgentImportInstructionSchema),
  memory: z.array(AgentImportMemorySchema),
  skills: z.array(AgentImportSkillSchema),
  model: AgentImportModelSchema.nullable(),
  mcpServers: z.array(AgentImportMcpServerSchema),
  routines: z.array(AgentImportRoutineSchema),
  apiKeys: z.array(AgentImportApiKeySchema),
  skipped: z.array(z.object({ path: z.string(), reason: AgentImportSkipReasonSchema })),
});
export type AgentImportPlan = z.infer<typeof AgentImportPlanSchema>;

export const AgentImportMemoryDestinationSchema = z.enum(["bot", "space"]);
export type AgentImportMemoryDestination = z.infer<typeof AgentImportMemoryDestinationSchema>;

const selectedId = z
  .string()
  .min(1)
  .max(AGENT_IMPORT_MAX_PATH_LENGTH + 20);
const selectedIds = z.array(selectedId);

export const AgentImportSelectionSchema = z.strictObject({
  instructions: selectedIds.max(AGENT_IMPORT_MAX_FILES),
  memory: z
    .array(z.strictObject({ id: selectedId, destination: AgentImportMemoryDestinationSchema }))
    .max(AGENT_IMPORT_MAX_FILES),
  skills: selectedIds.max(AGENT_IMPORT_MAX_FILES),
  model: z.boolean().default(false),
  mcpServers: selectedIds.max(AGENT_IMPORT_MAX_FILES).default([]),
  routines: selectedIds.max(AGENT_IMPORT_MAX_FILES).default([]),
  apiKeys: selectedIds.max(AGENT_IMPORT_MAX_FILES).default([]),
  acceptedRisks: selectedIds.max(AGENT_IMPORT_MAX_FILES).default([]),
});

const includeSecrets = z.boolean().default(false);

const skillFiles = z
  .record(
    z.string().max(AGENT_IMPORT_MAX_PATH_LENGTH),
    z.array(z.string().max(AGENT_IMPORT_MAX_PATH_LENGTH)).max(200),
  )
  .refine((value) => Object.keys(value).length <= AGENT_IMPORT_MAX_FILES)
  .default({});

export const AgentImportPreviewInput = z.strictObject({
  files: AgentImportFilesSchema,
  includeSecrets,
  skillFiles,
});

export const AgentImportCreateInput = z.strictObject({
  importKey: z
    .string()
    .trim()
    .min(8)
    .max(100)
    .refine(
      (key) => !key.startsWith(BOT_TEMPLATE_IMPORT_KEY_PREFIX),
      "That import key is reserved.",
    )
    .optional(),
  files: AgentImportFilesSchema,
  includeSecrets,
  skillFiles,
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
  description: z.string().trim().max(BOT_DESCRIPTION_MAX_LENGTH).default(""),
  computerMode: ComputerModeSchema.optional(),
  color: BotAvatarValueSchema.optional(),
  avatarSet: BotAvatarSetSchema.optional(),
  selection: AgentImportSelectionSchema,
});
export type AgentImportCreateInput = z.infer<typeof AgentImportCreateInput>;
