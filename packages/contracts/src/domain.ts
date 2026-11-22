import * as z from "zod";
import { AGENT_SECRET_NAME_PATTERN } from "./agent-secret-name.js";
import { BotAvatarSetSchema, BotAvatarValueSchema } from "./bot-avatar.js";
import { DisabledBuiltinToolsSchema } from "./builtin-tools.js";
import { ComputerModeSchema, ComputerStatusSchema } from "./computer.js";
import { BotSettingsValuesSchema, ThreadMessageSchema } from "./events.js";
import { Id, MemoryScope, ReplyModeSchema, RunStatus, ThinkingLevelSchema } from "./ids.js";
import { LabFeatureSchema } from "./labs.js";
import { NavLinkSchema } from "./nav-links.js";
import { RoutineWatchSchema, RoutineWatchStateSchema } from "./routine-watch.js";
import { RunTriggerSchema } from "./runs.js";
import { SkillSafetyFindingSchema } from "./skill-safety.js";
import { SpaceAvailabilitySchema } from "./space-availability.js";

export const MemoryScopeSchema = z.enum(["isolated", "shared"]);

export const AvatarStyleSchema = z.enum(["robot", "organic"]);

export function isValidTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown timezone" });

export const AppLocaleSchema = z.enum([
  "en",
  "de",
  "ko",
  "tr",
  "hi",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "es",
  "ru",
  "fr",
  "he",
  "nl",
  "ja",
  "pl",
]);

export { AGENT_SECRET_NAME_PATTERN };

export const AgentSecretSchema = z.object({
  id: Id,
  name: z.string().regex(AGENT_SECRET_NAME_PATTERN),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentSecret = z.infer<typeof AgentSecretSchema>;

export const AgentSecretInputSchema = z.object({
  name: z.string().trim().regex(AGENT_SECRET_NAME_PATTERN),
  value: z.string().min(1).max(16_384),
});

export const InstructionVersionSchema = z.object({
  id: Id,
  instructions: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});

export const BotSchema = z.object({
  id: Id,
  spaceId: Id,
  name: z.string(),
  title: z.string(),
  description: z.string(),
  instructions: z.string(),
  instructionHistory: z.array(InstructionVersionSchema).optional(),
  color: z.string(),
  avatarSet: BotAvatarSetSchema.optional(),
  notifyOnFinish: z.boolean(),
  pinned: z.boolean(),
  sectionId: Id.nullable(),
  archivedAt: z.string().nullable(),
  unread: z.boolean(),
  snoozedUntil: z.string().nullable().optional(),
  parentBotId: Id.nullable(),
  memoryScope: MemoryScopeSchema.nullable(),
  threadId: Id,
  preview: z.string(),
  status: z.string(),
  threadStatus: z.string().optional(),
  runErrorId: Id.nullable().default(null),
  computerMode: ComputerModeSchema,
  updatedAt: z.string(),
  createdAt: z.string(),
  voiceId: z.string().nullable(),
  autoSpeak: z.boolean(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: ThinkingLevelSchema.nullable(),
  fastMode: z.boolean().default(false),
  teamChatAmbientEnabled: z.boolean(),
  teamChatRules: z.string(),
  crossSpaceCommunication: z.boolean().optional(),
  dailyCheckIns: z.boolean().optional(),
  fleetManagement: z.boolean().default(true),
  replyMode: ReplyModeSchema.default("chat"),
  disabledBuiltinTools: z.array(z.string()).default([]),
  webhookConfigured: z.boolean(),
  spawnKey: z.string().nullable(),
  incomingCall: z
    .object({
      callId: z.string(),
      reason: z.string(),
      opening: z.string(),
      expiresAt: z.string(),
    })
    .nullable()
    .optional(),
});
export type Bot = z.infer<typeof BotSchema>;

export const IncomingBotCallSchema = BotSchema.pick({
  id: true,
  spaceId: true,
  name: true,
  color: true,
  avatarSet: true,
}).extend({
  incomingCall: BotSchema.shape.incomingCall.unwrap().unwrap(),
});
export type IncomingBotCall = z.infer<typeof IncomingBotCallSchema>;

export const ChatAlertSchema = z.object({
  kind: z.enum(["completion", "failure", "help", "takeover"]),
  title: z.string(),
  body: z.string(),
  spaceId: Id,
  botId: Id,
  threadId: Id,
  groupId: Id.optional(),
});
export type ChatAlert = z.infer<typeof ChatAlertSchema>;

export const ReorderBotsInput = z.object({
  botIds: z
    .array(Id)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { error: "botIds must be distinct" }),
});
export type ReorderBotsInput = z.infer<typeof ReorderBotsInput>;

export const GroupMemberSchema = z.object({
  botId: Id,
  name: z.string(),
  color: z.string(),
  avatarSet: BotAvatarSetSchema.optional(),
  status: z.string().optional(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const REPLY_QUOTE_MAX_LENGTH = 2_000;

export const THREAD_MESSAGE_TEXT_MAX_LENGTH = 100_000;

export function truncateReplyQuote(value: string): string {
  const truncated = value.slice(0, REPLY_QUOTE_MAX_LENGTH);
  const last = truncated.charCodeAt(truncated.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

export const GROUP_MEMBER_MIN = 2;
export const GROUP_MEMBER_MAX = 10;
export const GROUP_NAME_MAX_LENGTH = 80;

export function defaultGroupName(names: readonly string[]): string {
  const value = names.join(", ").trim().slice(0, GROUP_NAME_MAX_LENGTH);
  const last = value.charCodeAt(value.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value).trim();
}

export const GroupSchema = z.object({
  id: Id,
  spaceId: Id,
  name: z.string(),
  pinned: z.boolean(),
  sectionId: Id.nullable(),
  archivedAt: z.string().nullable(),
  members: z.array(GroupMemberSchema),
  threadId: Id,
  preview: z.string(),
  unread: z.boolean(),
  snoozedUntil: z.string().nullable().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type Group = z.infer<typeof GroupSchema>;

const GroupBotIds = z
  .array(Id)
  .min(GROUP_MEMBER_MIN)
  .max(GROUP_MEMBER_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { error: "botIds must be distinct" });

export const CreateGroupInput = z.object({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH),
  botIds: GroupBotIds,
});
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

export const UpdateGroupInput = z.object({
  groupId: Id,
  name: z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH).optional(),
  botIds: GroupBotIds.optional(),
  expectedBotIds: z.array(Id).max(GROUP_MEMBER_MAX).optional(),
  pinned: z.boolean().optional(),
  sectionId: Id.nullable().optional(),
});
export type UpdateGroupInput = z.infer<typeof UpdateGroupInput>;

export const GroupDetailSchema = GroupSchema.extend({
  messages: z.array(ThreadMessageSchema).optional(),
});

export const BotSectionName = z.string().trim().min(1).max(60);

export const BotSectionSchema = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotSection = z.infer<typeof BotSectionSchema>;

export const SpaceBotSchema = BotSchema.pick({
  id: true,
  spaceId: true,
  name: true,
  title: true,
  color: true,
  avatarSet: true,
  notifyOnFinish: true,
  pinned: true,
  sectionId: true,
  unread: true,
  snoozedUntil: true,
  parentBotId: true,
  preview: true,
  status: true,
  threadStatus: true,
  runErrorId: true,
  updatedAt: true,
});
export type SpaceBot = z.infer<typeof SpaceBotSchema>;

export const SpaceGroupSchema = GroupSchema.pick({
  id: true,
  spaceId: true,
  name: true,
  pinned: true,
  sectionId: true,
  members: true,
  preview: true,
  unread: true,
  snoozedUntil: true,
  updatedAt: true,
});
export type SpaceGroup = z.infer<typeof SpaceGroupSchema>;

export const TEAM_CHAT_RULES_MAX_LENGTH = 4000;
export const AutomatedSenderPolicyModeSchema = z.enum(["ignore", "rollup", "action", "user"]);
export type AutomatedSenderPolicyMode = z.infer<typeof AutomatedSenderPolicyModeSchema>;

export const AutomatedSenderPolicySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mode: AutomatedSenderPolicyModeSchema,
    rollupHours: z.number().int().min(1).max(720).optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.mode === "rollup" && policy.rollupHours === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Rollup policies require a frequency",
        path: ["rollupHours"],
      });
    }
  });
export type AutomatedSenderPolicy = z.infer<typeof AutomatedSenderPolicySchema>;

export const AutomatedSenderPoliciesSchema = z
  .record(z.string().trim().min(1).max(200), AutomatedSenderPolicySchema)
  .refine((policies) => Object.keys(policies).length <= 50, {
    message: "At most 50 automated sender policies are allowed",
  });
export type AutomatedSenderPolicies = z.infer<typeof AutomatedSenderPoliciesSchema>;

export const AutomatedSenderSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
});
export type AutomatedSender = z.infer<typeof AutomatedSenderSchema>;

export const ExternalConversationPolicySchema = z.object({
  teamChatAmbientEnabled: z.boolean().nullable(),
  teamChatRules: z.string().max(TEAM_CHAT_RULES_MAX_LENGTH).nullable(),
  automatedSenderPolicies: AutomatedSenderPoliciesSchema,
});
export type ExternalConversationPolicy = z.infer<typeof ExternalConversationPolicySchema>;

export const UpdateExternalConversationPolicyInput = ExternalConversationPolicySchema.extend({
  externalConversationId: Id,
});
export type UpdateExternalConversationPolicyInput = z.infer<
  typeof UpdateExternalConversationPolicyInput
>;

export const ExternalConversationSchema = z.object({
  id: Id,
  spaceId: Id,
  botId: Id,
  provider: z.string(),
  displayName: z.string().nullable(),
  participantNames: z.array(z.string()),
  teamChatAmbientEnabled: z.boolean().nullable(),
  teamChatRules: z.string().nullable(),
  automatedSenderPolicies: AutomatedSenderPoliciesSchema,
  automatedSenders: z.array(AutomatedSenderSchema),
  threadId: Id,
  preview: z.string(),
  unread: z.boolean(),
  updatedAt: z.string(),
});
export type ExternalConversation = z.infer<typeof ExternalConversationSchema>;

export const SpaceSchema = z.object({
  id: Id,
  name: z.string(),
  isDefault: z.boolean(),
  hasContent: z.boolean(),
  canRename: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  shared: z.boolean().optional(),
  botCount: z.number().int().nonnegative().optional(),
  bots: z.array(SpaceBotSchema),
  groups: z.array(SpaceGroupSchema),
  externalConversations: z.array(ExternalConversationSchema),
  botSections: z.array(BotSectionSchema),
});
export type Space = z.infer<typeof SpaceSchema>;

export const SpaceRoleSchema = z.enum(["owner", "member"]);

export const SpaceMemberSchema = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: SpaceRoleSchema,
});
export type SpaceMember = z.infer<typeof SpaceMemberSchema>;

export const SpaceMembersSchema = z.object({
  spaceName: z.string(),
  members: z.array(SpaceMemberSchema),
  canManage: z.boolean(),
  openInvites: z.number().int().nonnegative().optional(),
});
export type SpaceMembers = z.infer<typeof SpaceMembersSchema>;

export const SpaceInviteLinkSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});

export const SpaceInvitePreviewSchema = z.object({
  spaceId: Id,
  spaceName: z.string(),
  inviterName: z.string(),
  alreadyMember: z.boolean(),
});
export type SpaceInvitePreview = z.infer<typeof SpaceInvitePreviewSchema>;

export const SpaceNavigationSchema = z.object({
  current: z.object({
    id: Id,
    name: z.string(),
    bots: z.array(BotSchema),
    groups: z.array(GroupSchema),
    externalConversations: z.array(ExternalConversationSchema),
    botSections: z.array(BotSectionSchema),
  }),
  spaces: z.array(SpaceSchema),
});
export type SpaceNavigation = z.infer<typeof SpaceNavigationSchema>;

export const BOT_NAME_MAX_LENGTH = 80;
export const BOT_DESCRIPTION_MAX_LENGTH = 4000;
export const BOT_INSTRUCTIONS_MAX_LENGTH = 20000;

export const PRIMARY_BOT_SPAWN_KEY = "primary";

export const CreateBotInput = z.object({
  id: z
    .string()
    .regex(/^c[a-z0-9]{24}$/)
    .optional(),
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
  description: z.string().max(BOT_DESCRIPTION_MAX_LENGTH).default(""),
  instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).default(""),
  notifyOnFinish: z.boolean().default(true),
  dailyCheckIns: z.boolean().optional(),
  fleetManagement: z.boolean().optional(),
  color: BotAvatarValueSchema.optional(),
  avatarSet: BotAvatarSetSchema.optional(),
  avatarFamily: z.number().int().min(0).max(9).optional(),
  computerMode: ComputerModeSchema.optional(),
  spawnKey: z.string().trim().min(1).max(120).optional(),
});
export type CreateBotInput = z.infer<typeof CreateBotInput>;

export const UpdateBotInput = z
  .object({
    botId: Id,
    name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH).optional(),
    description: z.string().trim().max(BOT_DESCRIPTION_MAX_LENGTH).optional(),
    instructions: z.string().trim().max(BOT_INSTRUCTIONS_MAX_LENGTH).optional(),
    expectedInstructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).optional(),
    selfUpdateInstructions: z.boolean().optional(),
    notifyOnFinish: z.boolean().optional(),
    color: BotAvatarValueSchema.optional(),
    avatarSet: BotAvatarSetSchema.optional(),
    pinned: z.boolean().optional(),
    memoryScope: MemoryScopeSchema.nullable().optional(),
    sectionId: Id.nullable().optional(),
    voiceId: z.string().max(120).nullable().optional(),
    autoSpeak: z.boolean().optional(),
    modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
    modelId: z.string().trim().min(1).max(200).nullable().optional(),
    thinkingLevel: ThinkingLevelSchema.nullable().optional(),
    fastMode: z.boolean().optional(),
    teamChatAmbientEnabled: z.boolean().optional(),
    teamChatRules: z.string().max(TEAM_CHAT_RULES_MAX_LENGTH).optional(),
    crossSpaceCommunication: z.boolean().optional(),
    dailyCheckIns: z.boolean().optional(),
    fleetManagement: z.boolean().optional(),
    replyMode: ReplyModeSchema.optional(),
    disabledBuiltinTools: DisabledBuiltinToolsSchema.optional(),
    expectedSettings: BotSettingsValuesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const providerProvided = value.modelProvider !== undefined;
    const modelProvided = value.modelId !== undefined;
    if (!providerProvided && !modelProvided) return;
    if (providerProvided !== modelProvided) {
      ctx.addIssue({
        code: "custom",
        message: "Model provider and model id must both be set or both cleared",
        path: ["modelId"],
      });
      return;
    }
    const bothNull = value.modelProvider === null && value.modelId === null;
    const bothSet = Boolean(value.modelProvider) && Boolean(value.modelId);
    if (!bothNull && !bothSet) {
      ctx.addIssue({
        code: "custom",
        message: "Model provider and model id must both be set or both cleared",
        path: ["modelId"],
      });
    }
  });
export type UpdateBotInput = z.infer<typeof UpdateBotInput>;

export function routineModelIssues(
  value: {
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
  },
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void },
) {
  const providerProvided = value.modelProvider !== undefined && value.modelProvider !== null;
  const modelProvided = value.modelId !== undefined && value.modelId !== null;
  if (providerProvided !== modelProvided) {
    ctx.addIssue({
      code: "custom",
      message: "Model provider and model id must both be set or both cleared",
      path: ["modelId"],
    });
    return;
  }
  if (value.thinkingLevel && !providerProvided) {
    ctx.addIssue({
      code: "custom",
      message: "Pick a model for this routine first",
      path: ["thinkingLevel"],
    });
  }
}

export const ROUTINE_MENTION_BATCH_MAX = 100;

export const ROUTINE_TRIGGER_REQUIRED =
  "Add a schedule, webhook, GitHub, message, email, or change trigger";

export const RoutineEmailSendersSchema = z.enum(["owner", "domain"]);
export type RoutineEmailSenders = z.infer<typeof RoutineEmailSendersSchema>;

export const RoutineSchema = z.object({
  id: Id,
  botId: Id,
  name: z.string(),
  prompt: z.string(),
  crons: z.array(z.string()),
  timezone: z.string(),
  active: z.boolean(),
  notify: z.boolean(),
  webhookEnabled: z.boolean(),
  githubEnabled: z.boolean(),
  messageProvider: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9._-]+$/i)
    .nullable(),
  emailSenders: RoutineEmailSendersSchema.nullable().default(null),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: ThinkingLevelSchema.nullable(),
  watch: RoutineWatchSchema.nullable(),
  watchState: RoutineWatchStateSchema.nullable(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  scheduleDelayed: z.boolean().optional(),
  createdAt: z.string(),
  editable: z.boolean().optional(),
});
export type Routine = z.infer<typeof RoutineSchema>;

export const CreateRoutineInput = z
  .object({
    botId: Id,
    name: z.string().min(1).max(80),
    prompt: z.string().min(1),
    crons: z.array(z.string().min(1)).default([]),
    timezone: TimeZoneSchema.default("UTC"),
    notify: z.boolean().default(true),
    active: z.boolean().default(false),
    webhookEnabled: z.boolean().default(false),
    githubEnabled: z.boolean().default(false),
    messageProvider: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9._-]+$/i)
      .nullable()
      .default(null),
    emailSenders: RoutineEmailSendersSchema.nullable().default(null),
    modelProvider: z.string().trim().min(1).max(80).nullable().default(null),
    modelId: z.string().trim().min(1).max(200).nullable().default(null),
    thinkingLevel: ThinkingLevelSchema.nullable().default(null),
    watch: RoutineWatchSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    routineModelIssues(value, ctx);
    if (
      value.crons.length === 0 &&
      !value.webhookEnabled &&
      !value.githubEnabled &&
      !value.messageProvider &&
      !value.emailSenders &&
      !value.watch
    ) {
      ctx.addIssue({
        code: "custom",
        message: ROUTINE_TRIGGER_REQUIRED,
        path: ["crons"],
      });
    }
    if (value.watch && value.crons.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "A change trigger checks on its own interval; remove the schedule",
        path: ["watch"],
      });
    }
  });
export type CreateRoutineInput = z.infer<typeof CreateRoutineInput>;

export const ScratchpadItemStatusSchema = z.enum(["open", "parked", "done"]);

export const ScratchpadItemSchema = z.object({
  id: Id,
  botId: Id,
  title: z.string(),
  status: ScratchpadItemStatusSchema,
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScratchpadItem = z.infer<typeof ScratchpadItemSchema>;

export const CreateScratchpadItemInput = z.object({
  botId: Id,
  title: z.string().min(1).max(200),
  status: ScratchpadItemStatusSchema.default("open"),
  notes: z.string().max(4_000).default(""),
});

export const TaughtSkillStatusSchema = z.enum(["recording", "drafting", "draft", "saved"]);

export const SkillPlaybookSchema = z.object({
  whenToUse: z.string(),
  inputs: z.array(z.string()),
  steps: z.array(z.string()),
  howToCheck: z.string(),
  whatToReturn: z.string(),
  approvalBoundaries: z.string(),
  failureHandling: z.string(),
});
export type SkillPlaybook = z.infer<typeof SkillPlaybookSchema>;

export const TeachRecordingEventSchema = z.object({
  at: z.string(),
  kind: z.enum(["pointer", "key", "clipboard", "snapshot", "scroll"]),
  x: z.number().optional(),
  y: z.number().optional(),
  button: z.string().optional(),
  type: z.string().optional(),
  key: z.string().optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
  sensitive: z.boolean().optional(),
});
export type TeachRecordingEvent = z.infer<typeof TeachRecordingEventSchema>;

export const TeachSnapshotSchema = z.object({
  at: z.string(),
  summary: z.string(),
  hash: z.string().optional(),
});
export type TeachSnapshot = z.infer<typeof TeachSnapshotSchema>;

export const TeachRecordingSchema = z.object({
  events: z.array(TeachRecordingEventSchema),
  snapshots: z.array(TeachSnapshotSchema),
  controlLeaseId: z.string().optional(),
});
export type TeachRecording = z.infer<typeof TeachRecordingSchema>;

export const TaughtSkillSchema = z.object({
  id: Id,
  botId: Id,
  name: z.string(),
  goal: z.string(),
  status: TaughtSkillStatusSchema,
  playbook: SkillPlaybookSchema,
  recording: TeachRecordingSchema,
  startedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaughtSkill = z.infer<typeof TaughtSkillSchema>;

export const AgentSkillSourceSchema = z.enum(["user", "builtin", "plugin"]);
export type AgentSkillSource = z.infer<typeof AgentSkillSourceSchema>;

export const AvailabilityKindSchema = z.enum(["skill", "mcpServer", "install"]);
export type AvailabilityKind = z.infer<typeof AvailabilityKindSchema>;

export const AccountItemSchema = z.object({
  kind: AvailabilityKindSchema,
  id: Id,
  name: z.string(),
  availability: SpaceAvailabilitySchema,
});
export type AccountItem = z.infer<typeof AccountItemSchema>;

export const AgentSkillSchema = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  content: z.string(),
  source: AgentSkillSourceSchema,
  readOnly: z.boolean(),
  availability: SpaceAvailabilitySchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentSkillCatalogEntrySchema = AgentSkillSchema.pick({
  id: true,
  name: true,
  description: true,
  source: true,
  readOnly: true,
  availability: true,
});
export type AgentSkillCatalogEntry = z.infer<typeof AgentSkillCatalogEntrySchema>;

export const CreateAgentSkillInput = z
  .object({
    content: z.string().min(1).max(100_000).optional(),
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(2000).optional(),
    body: z.string().max(100_000).optional(),
    acceptRisk: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (input.content?.trim()) return;
    if (!input.name?.trim() || !input.description?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Provide content (SKILL.md) or name + description (+ optional body)",
        path: ["content"],
      });
    }
  });

export const UpdateAgentSkillInput = z
  .object({
    skillId: Id,
    content: z.string().min(1).max(100_000).optional(),
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(2000).optional(),
    body: z.string().max(100_000).optional(),
    acceptRisk: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (
      input.content === undefined &&
      input.name === undefined &&
      input.description === undefined &&
      input.body === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one field to update",
        path: ["content"],
      });
    }
  });

export const MemoryDocumentSchema = z.object({
  id: Id,
  scope: MemoryScope,
  botId: Id.nullable(),
  path: z.string(),
  content: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;

export const MemoryPromptDocumentUseSchema = z.object({
  scope: MemoryScope,
  path: z.string(),
  revision: z.number().int(),
  totalBytes: z.number().int().nonnegative(),
  includedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type MemoryPromptDocumentUse = z.infer<typeof MemoryPromptDocumentUseSchema>;

export const MemoryPromptBudgetSchema = z.object({
  limitBytes: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  documents: z.array(MemoryPromptDocumentUseSchema),
  omitted: z.array(MemoryPromptDocumentUseSchema),
});
export type MemoryPromptBudget = z.infer<typeof MemoryPromptBudgetSchema>;

export const MEMORY_INDEX_PATH = "MEMORY.md";
export const BOT_MEMORY_MAX_BYTES = 4 * 1024;
export function isDeletableMemoryDocument(path: string): boolean {
  return path !== MEMORY_INDEX_PATH;
}

export const ConnectionSchema = z.object({
  id: Id,
  connectorId: z.string(),
  provider: z.string(),
  displayName: z.string(),
  status: z.enum(["pending", "connected", "revoked", "error"]),
  capabilities: z.array(z.string()),
  createdAt: z.string(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ConnectionCatalogItemSchema = z.object({
  connectorId: z.string(),
  slug: z.string(),
  name: z.string(),
  logo: z.string().nullable(),
  connected: z.boolean(),
  noAuth: z.boolean(),
});
export type ConnectionCatalogItem = z.infer<typeof ConnectionCatalogItemSchema>;

export const ConnectionToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  readOnly: z.boolean().optional(),
});
export type ConnectionTool = z.infer<typeof ConnectionToolSchema>;

export const ActionApprovalRuleSchema = z.object({
  id: Id,
  effect: z.enum(["always_allow", "require_approval", "deny"]),
  matchKind: z.enum(["tool", "connector", "category", "site"]),
  matchValue: z.string(),
  createdAt: z.string(),
});
export type ActionApprovalRule = z.infer<typeof ActionApprovalRuleSchema>;

export const ApprovalModeSchema = z.enum(["never", "auto", "ask"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ActionAutoReviewSettingsSchema = z.object({
  mode: ApprovalModeSchema,
  enabled: z.boolean(),
  checkerAvailable: z.boolean(),
  skipApprovals: z.boolean(),
});
export type ActionAutoReviewSettings = z.infer<typeof ActionAutoReviewSettingsSchema>;

export const CapabilityInstallSchema = z.object({
  id: Id,
  kind: z.enum(["skill", "plugin", "mcp", "api", "graphql", "connection"]),
  name: z.string(),
  source: z.string(),
  version: z.string().nullable(),
  digest: z.string().nullable(),
  secretConfigured: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  availability: SpaceAvailabilitySchema.optional(),
  createdAt: z.string(),
});
export type CapabilityInstall = z.infer<typeof CapabilityInstallSchema>;

export const PluginPreviewSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()).optional(),
  safety: z.array(SkillSafetyFindingSchema).optional(),
});
export const PluginPreviewMcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(["streamable_http", "sse"]),
  endpoint: z.string(),
  staticHeaderKeys: z.array(z.string()),
});
export const PluginPreviewSkippedSchema = z.object({
  kind: z.enum([
    "mcp_stdio",
    "mcp_invalid",
    "skill_invalid",
    "editor_only",
    "unsupported_transport",
    "unsupported_field",
  ]),
  name: z.string(),
  reason: z.string(),
});
export const PluginPreviewSchema = z.object({
  format: z.enum(["agent-plugins", "cursor", "grok"]),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  author: z.string().nullable(),
  homepage: z.string().nullable(),
  repository: z.string().nullable(),
  license: z.string().nullable(),
  keywords: z.array(z.string()),
  resolvedSha: z.string().regex(/^[a-f0-9]{40}$/),
  pinnedSource: z.string().optional(),
  installedSource: z.string().optional(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  skills: z.array(PluginPreviewSkillSchema),
  mcpServers: z.array(PluginPreviewMcpServerSchema),
  skipped: z.array(PluginPreviewSkippedSchema),
  builtinNames: z.array(z.string()).optional(),
});
export type PluginPreview = z.infer<typeof PluginPreviewSchema>;

export const PluginPartSchema = z.enum(["connector", "skills"]);
export type PluginPart = z.infer<typeof PluginPartSchema>;

export const PluginMarketplaceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  category: z.string().nullable(),
  logo: z.string().nullable(),
  homepage: z.string().nullable(),
  domains: z.array(z.string()),
  registry: z.string(),
  source: z.string(),
  installedSource: z.string(),
  hasConnector: z.boolean(),
  skillCount: z.number().int().nonnegative(),
});
export type PluginMarketplaceEntry = z.infer<typeof PluginMarketplaceEntrySchema>;
export const PluginMarketplaceCatalogSchema = z.object({
  entries: z.array(PluginMarketplaceEntrySchema),
  unavailableRegistries: z.array(z.string()),
  skippedEntries: z.number().int().nonnegative(),
});
export type PluginMarketplaceCatalog = z.infer<typeof PluginMarketplaceCatalogSchema>;

export const PLUGIN_SUBMISSIONS_PATH = "/api/v1/plugin-submissions";
export const INTEGRATION_CLAIMS_PATH = "/api/v1/integration-claims";
export const INTEGRATION_CLAIM_CONFIRM_PATH = "/api/v1/integration-claims/confirm";
export const SUBMIT_PLUGIN_URL = "https://tryrobots.app/";
export const integrationPageUrl = (_slug: string) => "https://tryrobots.app/#integrations";

const HttpsUrlSchema = z
  .string()
  .trim()
  .transform((value) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`))
  .pipe(
    z
      .string()
      .max(2048)
      .url()
      .refine((value) => value.startsWith("https://"), "Use an https:// URL"),
  );

export const PluginSubmissionInputSchema = z.object({
  email: z.string().trim().max(254).email(),
  name: z.string().trim().min(1).max(80),
  website: HttpsUrlSchema.optional(),
  logo: HttpsUrlSchema,
  source: HttpsUrlSchema,
  description: z.string().trim().min(1).max(2000),
  testing: z.string().trim().min(1).max(4000),
  tested: z.literal(true),
});

export const IntegrationClaimInputSchema = z.object({
  claim: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use the page's URL slug"),
  email: z.string().trim().max(254).email(),
  name: z.string().trim().min(1).max(80),
  website: HttpsUrlSchema,
});

export const IntegrationClaimSchema = z.object({
  slug: z.string(),
  website: z.string(),
});
export type IntegrationClaim = z.infer<typeof IntegrationClaimSchema>;

export const PluginSubmissionStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type PluginSubmissionStatus = z.infer<typeof PluginSubmissionStatusSchema>;

export const PluginSubmissionSchema = PluginSubmissionInputSchema.omit({ tested: true }).extend({
  id: z.string(),
  website: z.string().nullable(),
  logo: z.string().nullable(),
  source: z.string().nullable(),
  testing: z.string().nullable(),
  description: z.string(),
  claim: z.string().nullable(),
  status: PluginSubmissionStatusSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type PluginSubmission = z.infer<typeof PluginSubmissionSchema>;

export const PluginSubmissionReviewSchema = z.discriminatedUnion("decision", [
  z.object({ id: Id, decision: z.literal("approve") }),
  z.object({ id: Id, decision: z.literal("reject"), reason: z.string().trim().min(1).max(1000) }),
]);
export type PluginSubmissionReview = z.infer<typeof PluginSubmissionReviewSchema>;

export const AccessGrantInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email(),
    creditCents: z.number().int().min(0).max(100_000).default(0),
    freeMonths: z.number().int().min(0).max(12).default(0),
  })
  .refine((grant) => grant.creditCents > 0 || grant.freeMonths > 0, {
    message: "Grant credits, free months, or both",
  });
export type AccessGrantInput = z.input<typeof AccessGrantInputSchema>;

export const AccessGrantSchema = z.object({
  id: Id,
  email: z.string(),
  creditCents: z.number().int(),
  freeMonths: z.number().int(),
  createdBy: z.string().nullable(),
  status: z.enum(["pending", "applied", "revoked"]),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const IntegrationCatalogSurfaceSchema = z.object({
  kind: z.enum(["mcp", "openapi", "graphql", "cli"]),
  slug: z.string(),
  source: z.string().nullable(),
  auth: z
    .object({
      type: z.enum(["none", "bearer", "header"]),
      headerName: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
});
export type IntegrationCatalogSurface = z.infer<typeof IntegrationCatalogSurfaceSchema>;

export const CATALOG_SEARCH_QUERY_MAX_LENGTH = 253;

export const IntegrationCatalogResultSchema = z.object({
  domain: z.string(),
  name: z.string(),
  description: z.string(),
  pageUrl: z.string().nullable(),
  surfaces: z.array(IntegrationCatalogSurfaceSchema),
});
export type IntegrationCatalogResult = z.infer<typeof IntegrationCatalogResultSchema>;

export const ArtifactSchema = z.object({
  id: Id,
  botId: Id.nullable(),
  groupId: Id.nullable(),
  runId: Id.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  mimeType: z.string(),
  size: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactVersionSchema = z.object({
  id: Id,
  version: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
});

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const ArtifactWithContentSchema = ArtifactSchema.extend({
  contentBase64: z.string(),
});
export type ArtifactWithContent = z.infer<typeof ArtifactWithContentSchema>;

export const UsageRecordSchema = z.object({
  id: Id,
  botId: Id.nullable(),
  runId: Id.nullable(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cacheReadTokens: z.number().int().nullable().optional(),
  cacheWriteTokens: z.number().int().nullable().optional(),
  cacheWrite1hTokens: z.number().int().nullable().optional(),
  reasoningTokens: z.number().int().nullable().optional(),
  totalTokens: z.number().int().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  costSource: z.string().nullable().optional(),
  pricingVersion: z.string().nullable().optional(),
  usageSource: z.string().nullable().optional(),
  callId: z.string().nullable().optional(),
  operationId: z.string().nullable().optional(),
  operationKind: z.enum(["answer", "setup", "retrieval", "subagent", "compaction"]).optional(),
  parentRunId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  createdAt: z.string(),
});

const UsageTotalsSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable().optional(),
  costUsd: z.number().nullable().optional(),
  modelCalls: z.number().optional(),
});
export const UsageSummarySchema = UsageTotalsSchema.extend({
  runs: z.number(),
  models: z
    .array(UsageTotalsSchema.required().extend({ provider: z.string(), model: z.string() }))
    .optional(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const PlanLimitWindowSchema = z.object({
  period: z.enum(["session", "week", "month"]),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().nullable(),
});
export type PlanLimitWindow = z.infer<typeof PlanLimitWindowSchema>;
export const PlanLimitsSchema = z.object({
  credentialId: z.string(),
  name: z.string(),
  label: z.string(),
  windows: z.array(PlanLimitWindowSchema).min(1),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export function planUsagePercent(plans: readonly PlanLimits[]): number | null {
  if (!plans.length) return null;
  return Math.min(
    ...plans.map((plan) => Math.max(...plan.windows.map((window) => window.usedPercent))),
  );
}

export const MessagingLinkedIdentitySchema = z.object({
  id: Id,
  provider: z.string(),
  address: z.string(),
  botId: Id,
  botName: z.string(),
});

export const MessagingInstallationSummarySchema = z.object({
  id: Id,
  provider: z.string(),
  workspaceName: z.string(),
  botId: Id,
  botName: z.string().optional(),
});
export type MessagingInstallationSummary = z.infer<typeof MessagingInstallationSummarySchema>;
export const MessagingInstallationsStatusSchema = z.object({
  available: z.boolean(),
  personalLinkAvailable: z.boolean().optional(),
  installations: z.array(MessagingInstallationSummarySchema),
});
export type MessagingInstallationsStatus = z.infer<typeof MessagingInstallationsStatusSchema>;

export const MessagingStatusSchema = z.object({
  enabled: z.boolean(),
  providers: z.array(z.string()),
  addresses: z.record(z.string(), z.string()).optional(),
  openSignup: z.boolean(),
  identities: z.array(MessagingLinkedIdentitySchema),
});
export type MessagingStatus = z.infer<typeof MessagingStatusSchema>;

export const MessagingChannelMembershipSchema = z.object({
  id: Id,
  channelId: Id,
  identityId: Id,
  provider: z.string(),
  name: z.string().nullable(),
  status: z.enum(["invited", "approved", "declined", "left"]),
  memberCount: z.number().int().nonnegative(),
});
export type MessagingChannelMembership = z.infer<typeof MessagingChannelMembershipSchema>;

export const MessagingAgentConnectionSchema = z.object({
  id: Id,
  peerBotName: z.string(),
  peerOwnerLabel: z.string(),
  status: z.enum(["pending", "approved", "declined", "revoked"]),
  incoming: z.boolean(),
});
export type MessagingAgentConnection = z.infer<typeof MessagingAgentConnectionSchema>;

export const RunSchema = z.object({
  id: Id,
  userId: Id.optional(),
  botId: Id,
  threadId: Id,
  taskId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  routineId: Id.nullable(),
  routineName: z.string().nullable().optional(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const ThreadMessagePageSchema = z.object({
  threadId: Id,
  messages: z.array(ThreadMessageSchema),
  olderCursor: z.number().int().nonnegative().nullable(),
  coveredThroughSeq: z.number().int().nonnegative().optional(),
});
export type ThreadMessagePage = z.infer<typeof ThreadMessagePageSchema>;

export const ThreadSnapshotSchema = z.object({
  threadId: Id,
  cursor: z.number().int().min(-1),
  messages: z.array(ThreadMessageSchema),
  olderCursor: z.number().int().nonnegative().nullable(),
  botId: Id.optional(),
  groupId: Id.optional(),
  groupName: z.string().optional(),
  members: z.array(GroupMemberSchema).optional(),
  run: RunSchema.nullable(),
  activeRuns: z.array(RunSchema).optional(),
  computer: ComputerStatusSchema.optional(),
});
export type ThreadSnapshot = z.infer<typeof ThreadSnapshotSchema>;

export const CONNECTION_LABEL_MAX_LENGTH = 80;

export const SpaceMemoryConfigSchema = z.object({
  provider: z.string(),
  settings: z.record(z.string(), z.string()),
  defaultMemoryScope: MemoryScopeSchema,
  updatedAt: z.string(),
});
export type SpaceMemoryConfig = z.infer<typeof SpaceMemoryConfigSchema>;

export const VoiceCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  transcribe: z.boolean(),
  keyless: z.boolean().optional(),
  speechModel: z.boolean().optional(),
  modelConnection: z.boolean().optional(),
  languages: z.boolean().optional(),
});
export type VoiceCatalogEntry = z.infer<typeof VoiceCatalogEntrySchema>;

export const VoiceInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfoSchema>;

export const VoiceCredentialSchema = z.object({
  id: Id,
  provider: z.string(),
  hasKey: z.boolean(),
  isDefault: z.boolean(),
  voiceId: z.string(),
  speechModel: z.string(),
  transcribe: z.boolean(),
  endpoint: z.string().default(""),
  sttEndpoint: z.string().default(""),
  ttsModel: z.string().default(""),
  sttModel: z.string().default(""),
});
export type VoiceCredential = z.infer<typeof VoiceCredentialSchema>;

export const VoiceStatusSchema = z.object({
  configured: z.boolean(),
  ready: z.boolean(),
  transcribe: z.boolean(),
  provider: z.string().nullable(),
  voiceId: z.string(),
});
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const DeploymentSettingsSchema = z.object({
  ownerUserId: Id.nullable(),
  signupsEnabled: z.boolean(),
  signupAllowlist: z.array(z.string()),
  hasDeploymentModelCredential: z.boolean(),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  computerHost: z.enum(["docker", "this-mac"]).nullable(),
  canChooseHostComputer: z.boolean(),
  sandboxProvider: z.string(),
});

export const ServerUpdateSourceSchema = z.object({
  repoUrl: z.string().max(400),
  branch: z.string().max(200),
  official: z.boolean(),
});

export const ServerUpdateStepSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(200),
  ok: z.boolean(),
  exitCode: z.number().int().nullable(),
  output: z.string().max(8_001),
});

export const ServerUpdateStrategySchema = z.enum(["pull", "build", "checkout"]);

export const ServerUpdateModeSchema = z.enum(["sidecar", "checkout", "unavailable"]);

export const ServerUpdateInstallKindSchema = z.enum(["sidecar", "compose", "source"]);

export const ServerUpdateRunSchema = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  ok: z.boolean(),
  fromCommit: z.string().nullable(),
  toCommit: z.string().nullable(),
  fromTag: z.string().nullable(),
  toTag: z.string().nullable(),
  strategy: ServerUpdateStrategySchema.nullable(),
  repoUrl: z.string().max(400),
  branch: z.string().max(200),
  restart: z.enum(["recreated", "supervised", "manual", "not-required"]),
  restartAdvice: z.string(),
  error: z.string().nullable(),
  steps: z.array(ServerUpdateStepSchema),
});
export type ServerUpdateRun = z.infer<typeof ServerUpdateRunSchema>;

export const ServerUpdateStatusSchema = z.object({
  supported: z.boolean(),
  unsupportedReason: z.string().nullable(),
  installKind: ServerUpdateInstallKindSchema,
  manualCommands: z.array(z.string()),
  mode: ServerUpdateModeSchema,
  strategy: ServerUpdateStrategySchema.nullable(),
  strategyNote: z.string().nullable(),
  version: z.string(),
  revision: z.string().nullable(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  dirty: z.boolean(),
  dirtyPaths: z.array(z.string()),
  image: z.string().nullable(),
  imageTag: z.string().nullable(),
  previousImageTag: z.string().nullable(),
  canRollback: z.boolean(),
  source: ServerUpdateSourceSchema,
  officialRepoUrl: z.string(),
  restartSupervisor: z.enum(["systemd", "pm2", "declared", "none"]),
  restartAdvice: z.string(),
  running: z.boolean(),
  lastRun: ServerUpdateRunSchema.nullable(),
});

export const ServerUpdateCheckSchema = z.object({
  status: z.enum(["unavailable", "dirty", "up-to-date", "available"]),
  reason: z.string().nullable(),
  changed: z.array(z.string()),
  commit: z.string().nullable(),
  targetCommit: z.string().nullable(),
  targetTag: z.string().nullable(),
  behindBy: z.number().int().nonnegative(),
});

export const ServerUpdateRequestSchema = z.object({
  repoUrl: z.string().max(400).optional(),
  branch: z.string().max(200).optional(),
});

export const MeSchema = z.object({
  maxUploadSizeBytes: z.number().int().positive().optional(),
  maxAttachmentsPerMessage: z.number().int().positive().optional(),
  labs: z.array(LabFeatureSchema).default([]),
  labsAvailable: z.array(LabFeatureSchema).default([]),
  ticketBoardEnabled: z.boolean(),
  phoneCallsEnabled: z.boolean().default(false),
  navLinks: z.array(NavLinkSchema).default([]),
  userId: Id,
  email: z.string().email(),
  name: z.string(),
  spaceId: Id,
  isDeploymentOwner: z.boolean(),
  isAdmin: z.boolean().default(false),
  needsModel: z.boolean(),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  hostCredentialProvider: z.string().nullable(),
  hostCredentialSource: z.string().nullable(),
  computerHost: z.enum(["docker", "this-mac"]).nullable(),
  canChooseHostComputer: z.boolean(),
  sandboxProvider: z.string(),
  computerSettingsEnabled: z.boolean().optional(),
  mcpStdioEnabled: z.boolean().default(false),
  avatarStyle: AvatarStyleSchema,
  botAvatarSet: BotAvatarSetSchema.optional(),
  timezone: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  billingEnabled: z.boolean(),
  needsSignupSurvey: z.boolean().optional(),
  paymentWalletProvider: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const SIGNUP_SURVEY_USES = ["personal", "work", "both"] as const;
export const SIGNUP_SURVEY_TEAM_SIZES = ["1", "2-10", "11-50", "51-200", "201+"] as const;

export function signupSurveyTeamSizeLabel(size: (typeof SIGNUP_SURVEY_TEAM_SIZES)[number]): string {
  return size === "201+" ? "200+" : size.replace("-", "–");
}

export const SignupSurveySchema = z.object({
  reason: z.string().trim().max(2000).optional(),
  use: z.enum(SIGNUP_SURVEY_USES).optional(),
  teamSize: z.enum(SIGNUP_SURVEY_TEAM_SIZES).optional(),
  source: z.string().trim().max(500).optional(),
});
export type SignupSurvey = z.infer<typeof SignupSurveySchema>;

export function signupSurveyAsksTeamSize(use: SignupSurvey["use"]): boolean {
  return use === "work" || use === "both";
}

export const AppBootstrapSchema = z.object({
  me: MeSchema,
  bots: z.array(BotSchema),
  groups: z.array(GroupSchema),
  botSections: z.array(BotSectionSchema),
  archivedBots: z.array(BotSchema),
  archivedGroups: z.array(GroupSchema),
  thread: ThreadSnapshotSchema.nullable(),
  routines: z.array(RoutineSchema),
  spaces: z.array(SpaceSchema),
  botSpaceId: Id.optional(),
  groupSpaceId: Id.optional(),
});
export type AppBootstrap = z.infer<typeof AppBootstrapSchema>;

export const ExportManifestSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  bot: BotSchema.pick({ name: true, description: true, instructions: true }).extend({
    color: z.string().optional(),
    avatarSet: BotAvatarSetSchema.optional(),
  }),
  memory: z.array(z.object({ path: z.string(), content: z.string() })),
  routines: z.array(RoutineSchema.pick({ name: true, prompt: true, crons: true, timezone: true })),
  files: z.array(
    z.object({ path: z.string(), content: z.string(), encoding: z.literal("base64").optional() }),
  ),
  history: z.array(ThreadMessageSchema),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
