import type {
  AnyContractProcedure,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";
import { ActionRuleListSchema, ActionRuleSchema } from "./action-rules.js";
import {
  AgentImportCreateInput,
  AgentImportPlanSchema,
  AgentImportPreviewInput,
} from "./agent-import.js";
import { AgentImportSetupStateInput, AgentImportSetupStateSchema } from "./agent-import-setup.js";
import { AiConsentQuerySchema, AiConsentStatusSchema } from "./ai-consent.js";
import { AnalyticsScreenInput } from "./analytics.js";
import {
  ARTIFACT_DESCRIPTION_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ATTACHMENT_COUNT_CEILING,
} from "./attachments.js";
import { AuditEventListInputSchema, AuditEventPageSchema } from "./audit-events.js";
import {
  BillingClientSchema,
  BillingStatusSchema,
  ByokIntervalSchema,
  ByokTierSchema,
  ModelCreditAmountSchema,
} from "./billing.js";
import {
  BoardEventSchema,
  BoardSchema,
  CommentTicketInput,
  CreateTicketInput,
  GetTicketInput,
  ListTicketsInput,
  ListTicketsOutput,
  MoveTicketInput,
  RenameBoardInput,
  TicketCommentSchema,
  TicketSchema,
  UpdateTicketInput,
} from "./board.js";
import { BotAvatarSetSchema } from "./bot-avatar.js";
import { BotEmailAddressesSchema, BotEmailAddressSchema, BotEmailNameSchema } from "./bot-email.js";
import { BotPackageSchema, ExportBotPackageInput } from "./bot-package.js";
import {
  BotSecretMetadata,
  BotSecretPutInput,
  LOGIN_FIELD_LIMIT,
  LoginFieldInput,
  StoredBotSecretName,
  VAULT_ACTIVITY_LIMIT,
  VaultPutInput,
  VaultRevealed,
  VaultRevealInput,
  VaultUse,
} from "./bot-secrets.js";
import {
  BotTemplateListingSchema,
  CreateBotFromTemplateInput,
  CreateBotFromTemplateOutput,
} from "./bot-template.js";
import {
  ComputerModeSchema,
  ComputerProviderSettingsSchema,
  ComputerProviderUpdateSchema,
  ComputerReleaseReasonSchema,
  ComputerScreenSchema,
  ComputerStatusSchema,
  ComputerUpdateSchema,
  HostBrowserImportSchema,
  HostBrowserProfileSchema,
} from "./computer.js";
import { PairedDeviceSchema, PairingCodeSchema } from "./device-pairing.js";
import { CreateDocInput, DocRevisionSchema, DocSchema } from "./docs.js";
import {
  AccessGrantInputSchema,
  AccessGrantSchema,
  AccountItemSchema,
  ActionApprovalRuleSchema,
  ActionAutoReviewSettingsSchema,
  AgentSecretInputSchema,
  AgentSecretSchema,
  AgentSkillCatalogEntrySchema,
  AgentSkillSchema,
  AppBootstrapSchema,
  AppLocaleSchema,
  ApprovalModeSchema,
  ArtifactSchema,
  ArtifactVersionSchema,
  ArtifactWithContentSchema,
  AvailabilityKindSchema,
  AvatarStyleSchema,
  BotSchema,
  BotSectionName,
  BotSectionSchema,
  CATALOG_SEARCH_QUERY_MAX_LENGTH,
  CapabilityInstallSchema,
  ChatAlertSchema,
  CONNECTION_LABEL_MAX_LENGTH,
  ConnectionCatalogItemSchema,
  ConnectionSchema,
  ConnectionToolSchema,
  CreateAgentSkillInput,
  CreateBotInput,
  CreateGroupInput,
  CreateRoutineInput,
  CreateScratchpadItemInput,
  DeploymentSettingsSchema,
  ExportManifestSchema,
  ExternalConversationPolicySchema,
  GroupDetailSchema,
  GroupSchema,
  IncomingBotCallSchema,
  IntegrationCatalogResultSchema,
  MemoryDocumentSchema,
  MemoryPromptBudgetSchema,
  MemoryScopeSchema,
  MeSchema,
  MessagingAgentConnectionSchema,
  MessagingChannelMembershipSchema,
  MessagingInstallationsStatusSchema,
  MessagingLinkedIdentitySchema,
  MessagingStatusSchema,
  PlanLimitsSchema,
  PluginMarketplaceCatalogSchema,
  PluginPartSchema,
  PluginPreviewSchema,
  PluginSubmissionReviewSchema,
  PluginSubmissionSchema,
  PluginSubmissionStatusSchema,
  REPLY_QUOTE_MAX_LENGTH,
  ReorderBotsInput,
  ROUTINE_MENTION_BATCH_MAX,
  ROUTINE_TRIGGER_REQUIRED,
  RoutineEmailSendersSchema,
  RoutineSchema,
  ScratchpadItemSchema,
  ScratchpadItemStatusSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
  SignupSurveySchema,
  SkillPlaybookSchema,
  SpaceInviteLinkSchema,
  SpaceInvitePreviewSchema,
  SpaceMembersSchema,
  SpaceMemoryConfigSchema,
  SpaceNavigationSchema,
  SpaceSchema,
  TaughtSkillSchema,
  TeachRecordingEventSchema,
  THREAD_MESSAGE_TEXT_MAX_LENGTH,
  ThreadMessagePageSchema,
  ThreadSnapshotSchema,
  TimeZoneSchema,
  UpdateAgentSkillInput,
  UpdateBotInput,
  UpdateExternalConversationPolicyInput,
  UpdateGroupInput,
  UsageRecordSchema,
  UsageSummarySchema,
  VoiceCatalogEntrySchema,
  VoiceCredentialSchema,
  VoiceInfoSchema,
  VoiceStatusSchema,
} from "./domain.js";
import {
  EmailMailboxesSchema,
  EmailMessageSchema,
  EmailMessagesInput,
  EmailMessagesPageSchema,
} from "./email-inbox.js";
import { ComputerCommandSchema, ProductEventSchema } from "./events.js";
import { Id, IsoDate, ThinkingLevelSchema } from "./ids.js";
import {
  IntegrationProviderConfigSchema,
  IntegrationSetupStateSchema,
} from "./integration-settings.js";
import { LabFeatureSchema } from "./labs.js";
import {
  BotMcpServerSchema,
  McpServerConfigInput,
  McpServerSchema,
  McpSourcePresetSchema,
} from "./mcp.js";
import {
  ModelApiProtocolSchema,
  ModelBackupChoiceSchema,
  ModelBackupListSchema,
  ModelCatalogEntrySchema,
  ModelConnectInputSchema,
  ModelConnectionLabelSchema,
  ModelConnectionTargetSchema,
  ModelCredentialSchema,
  ModelOAuthBeginSchema,
  ModelSettingsSaveSchema,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "./model-connections.js";
import { ModelHeadersSchema } from "./model-headers.js";
import { ModelRoleSchema, ModelRoleUpdateSchema, ModelRoleViewSchema } from "./model-roles.js";
import {
  PAGE_LIST_MAX_LIMIT,
  PageDetailSchema,
  PageSummarySchema,
  PageTitleSchema,
  PageVisibilitySchema,
} from "./pages.js";
import {
  PaymentWalletStatusSchema,
  SpendingLimitSchema,
  SpendingPaymentSchema,
  SpendingStatusSchema,
} from "./payments.js";
import { MessageReactionSchema } from "./reactions.js";
import { RoutineWatchSchema } from "./routine-watch.js";
import {
  ROUTINE_HISTORY_PAGE_SIZE,
  RoutineHistorySchema,
  RoutineRunCursorSchema,
  RunsListOutputSchema,
} from "./runs.js";
import { SearchQueryOutputSchema } from "./search.js";
import { SecurityEventListInputSchema, SecurityEventSchema } from "./security-events.js";
import { SettingsScopeSchema, SpaceSettingSchema, settingsScopeInput } from "./settings-scope.js";
import { SpaceAvailabilitySchema } from "./space-availability.js";
import { VaultImportInput, VaultImportResult } from "./vault-import.js";

const botId = z.object({ botId: Id });
const groupId = z.object({ groupId: Id });

const threadTarget = z
  .object({
    botId: Id.optional(),
    groupId: Id.optional(),
  })
  .superRefine((input, ctx) => {
    const hasBot = Boolean(input.botId);
    const hasGroup = Boolean(input.groupId);
    if (hasBot === hasGroup) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of botId or groupId",
        path: ["botId"],
      });
    }
  });

const structuredMentionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), id: Id }),
  z.object({ kind: z.literal("group"), id: Id }),
  z.object({ kind: z.literal("routine"), id: Id }),
  z.object({ kind: z.literal("connector"), id: Id }),
]);

const threadSendFields = threadTarget.safeExtend({
  imageHandling: z.enum(["confirm", "file"]).optional(),
  text: z.string().max(THREAD_MESSAGE_TEXT_MAX_LENGTH).optional(),
  artifactIds: z.array(Id).max(ATTACHMENT_COUNT_CEILING).optional(),
  mentions: z
    .array(z.union([Id, structuredMentionTarget]))
    .max(64)
    .optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().trim().min(1).max(REPLY_QUOTE_MAX_LENGTH).optional(),
  fromPage: z.literal(true).optional(),
  clientNonce: z.string().min(1).max(200).optional(),
});

export const threadSendInput = threadSendFields.superRefine((input, ctx) => {
  const text = input.text?.trim() ?? "";
  const artifactIds = input.artifactIds ?? [];
  if (!text && artifactIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text or at least one attachment",
      path: ["text"],
    });
  }
  if (input.replyQuote && !input.replyToMessageId) {
    ctx.addIssue({
      code: "custom",
      message: "replyQuote requires replyToMessageId",
      path: ["replyQuote"],
    });
  }
});

const threadSendOutput = z.object({
  taskId: Id,
  runId: Id,
  seq: z.number().int(),
  runIds: z.array(Id).optional(),
});

const threadSendWithRoutinesInput = threadSendFields.safeExtend({
  clientNonce: z.string().min(1).max(200),
  routineIds: z.array(Id).min(1).max(64),
});

export const SpaceChangeKind = z.enum(["computerUpdates", "runs", "routines", "email", "memory"]);
export type SpaceChangeKind = z.infer<typeof SpaceChangeKind>;

const spaceName = z.string().trim().min(1).max(60);
const organizationName = spaceName;
export const OrganizationListSchema = z.object({
  activeOrganizationId: Id,
  organizations: z.array(
    z.object({
      id: Id,
      name: z.string(),
      defaultSpaceId: Id,
      spaceIds: z.array(Id),
      canManage: z.boolean(),
    }),
  ),
});
export type OrganizationList = z.infer<typeof OrganizationListSchema>;

export const appContract = {
  analytics: { screen: oc.input(AnalyticsScreenInput).output(z.object({ ok: z.literal(true) })) },
  aiConsent: {
    status: oc.input(AiConsentQuerySchema).output(AiConsentStatusSchema),
    allow: oc
      .input(
        z.object({
          scope: z.string(),
          version: z.string(),
          keys: z.array(z.string()).min(1).max(200),
          settingsScope: SettingsScopeSchema.optional(),
        }),
      )
      .output(AiConsentStatusSchema),
    revoke: oc.input(z.object({ key: z.string().nullable() })).output(AiConsentStatusSchema),
  },
  health: oc.output(z.object({ ok: z.literal(true), version: z.string() })),
  me: oc.output(MeSchema),
  billing: {
    status: oc
      .input(z.object({ referralCode: z.string().min(1).max(64).optional() }).optional())
      .output(BillingStatusSchema),
    refresh: oc.output(BillingStatusSchema),
    selectFunding: oc
      .input(
        z.object({
          funding: z.enum(["byok", "credits"]),
          client: BillingClientSchema,
          interval: ByokIntervalSchema.optional(),
          tier: ByokTierSchema.optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true), url: z.string().url().optional() })),
    purchaseCredits: oc
      .input(
        z.object({
          amountCents: ModelCreditAmountSchema,
          monthly: z.boolean(),
          client: BillingClientSchema,
        }),
      )
      .output(z.object({ url: z.string().url() })),
    setMonthlyCredits: oc
      .input(z.object({ amountCents: ModelCreditAmountSchema }))
      .output(z.object({ ok: z.literal(true) })),
    checkout: oc
      .input(
        z
          .object({
            client: BillingClientSchema,
            interval: ByokIntervalSchema.optional(),
            tier: ByokTierSchema.optional(),
          })
          .optional(),
      )
      .output(z.object({ url: z.string().url() })),
    portal: oc
      .input(z.object({ client: BillingClientSchema }).optional())
      .output(z.object({ url: z.string().url() })),
    endTrial: oc.output(BillingStatusSchema),
    switchToYearly: oc.output(BillingStatusSchema),
    changeTier: oc.input(z.object({ tier: ByokTierSchema })).output(BillingStatusSchema),
    claimReferral: oc
      .input(z.object({ code: z.string().min(1).max(64) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  devicePairing: {
    create: oc.output(PairingCodeSchema),
    devices: oc.output(z.array(PairedDeviceSchema)),
    revoke: oc
      .input(z.object({ id: z.string().min(1).max(64) }))
      .output(z.object({ ok: z.literal(true) })),
    revokeOthers: oc.output(z.object({ revoked: z.number().int() })),
  },
  accessGrants: {
    list: oc.output(z.array(AccessGrantSchema)),
    create: oc.input(AccessGrantInputSchema).output(AccessGrantSchema),
    revoke: oc.input(z.object({ id: Id })).output(AccessGrantSchema),
  },
  preferences: {
    update: oc
      .input(
        z
          .object({
            avatarStyle: AvatarStyleSchema.optional(),
            botAvatarSet: BotAvatarSetSchema.optional(),
            timezone: TimeZoneSchema.nullable().optional(),
            locale: AppLocaleSchema.optional(),
            labs: z.array(LabFeatureSchema).optional(),
          })
          .refine(
            (input) =>
              input.avatarStyle !== undefined ||
              input.botAvatarSet !== undefined ||
              input.timezone !== undefined ||
              input.locale !== undefined ||
              input.labs !== undefined,
            { message: "Nothing to update" },
          ),
      )
      .output(MeSchema),
    adoptTimezone: oc.input(z.object({ timezone: TimeZoneSchema })).output(MeSchema),
  },
  spaces: {
    list: oc.output(SpaceNavigationSchema),
    create: oc.input(z.object({ name: spaceName })).output(SpaceSchema),
    rename: oc
      .input(z.object({ spaceId: Id, name: spaceName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ spaceId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
    members: {
      list: oc.input(z.object({ spaceId: Id })).output(SpaceMembersSchema),
      remove: oc
        .input(z.object({ spaceId: Id, userId: Id }))
        .output(z.object({ ok: z.literal(true) })),
      leave: oc
        .input(z.object({ spaceId: Id }))
        .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
    },
    invites: {
      create: oc.input(z.object({ spaceId: Id })).output(SpaceInviteLinkSchema),
      preview: oc
        .input(z.object({ token: z.string().min(1).max(200) }))
        .output(SpaceInvitePreviewSchema),
      accept: oc
        .input(z.object({ token: z.string().min(1).max(200) }))
        .output(z.object({ spaceId: Id })),
      cancel: oc.input(z.object({ spaceId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  organizations: {
    list: oc.output(OrganizationListSchema),
    create: oc
      .input(z.object({ name: organizationName }))
      .output(z.object({ id: Id, name: z.string(), defaultSpaceId: Id })),
    rename: oc
      .input(z.object({ organizationId: Id, name: organizationName }))
      .output(z.object({ id: Id, name: z.string() })),
    remove: oc
      .input(z.object({ organizationId: Id }))
      .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
  },
  bootstrap: oc
    .input(z.object({ botId: Id.optional(), groupId: Id.optional() }))
    .output(AppBootstrapSchema),
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  computerProvider: {
    get: oc.output(ComputerProviderSettingsSchema),
    update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    account: {
      get: oc.output(ComputerProviderSettingsSchema),
      update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    },
  },
  security: {
    events: oc.input(SecurityEventListInputSchema).output(z.array(SecurityEventSchema)),
  },
  audit: {
    events: oc.input(AuditEventListInputSchema).output(AuditEventPageSchema),
  },
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  models: {
    forRole: oc
      .input(z.object({ role: ModelRoleSchema, expectedUserId: Id.optional() }))
      .output(z.array(ModelCatalogEntrySchema)),
    role: oc
      .input(
        z.object({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    setRole: oc
      .input(
        ModelRoleUpdateSchema.extend({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    list: oc.output(z.array(ModelCatalogEntrySchema)),
    credentials: oc.output(z.array(ModelCredentialSchema)),
    backups: oc.output(z.array(ModelBackupChoiceSchema)),
    setBackups: oc.input(ModelBackupListSchema).output(z.object({ ok: z.literal(true) })),
    connect: oc.input(ModelConnectInputSchema).output(ModelCredentialSchema),
    probeOpenAiCompatible: oc
      .input(
        z.object({
          baseUrl: z.string(),
          credentialId: z.string().optional(),
          headers: ModelHeadersSchema.optional(),
          apiKey: z.string().optional(),
          apiProtocol: ModelApiProtocolSchema.optional(),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    probeCatalog: oc
      .input(
        z.object({
          provider: z.string().trim().min(1),
          apiKey: z.string().trim().min(8),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    beginOAuth: oc
      .input(
        z.object({
          provider: z.string(),
          label: z.string().optional(),
          credentialId: ModelConnectionTargetSchema,
          modelId: z.string().optional(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
          makeDefault: z.boolean().optional(),
          scope: SettingsScopeSchema.optional(),
          codePage: z.boolean().optional(),
        }),
      )
      .output(ModelOAuthBeginSchema),
    submitOAuthCode: oc
      .input(z.object({ loginId: z.string(), code: z.string().trim().min(1).max(8_192) }))
      .output(z.object({ ok: z.literal(true) })),
    completeOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("pending") }),
          z.object({ status: z.literal("ready") }),
          z.object({ status: z.literal("error"), error: z.string() }),
        ]),
      ),
    finishOAuth: oc.input(z.object({ loginId: z.string() })).output(ModelCredentialSchema),
    cancelOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    setDefault: oc
      .input(
        z.object({
          provider: z.string(),
          modelId: z.string(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    rename: oc
      .input(z.object({ credentialId: Id, label: ModelConnectionLabelSchema }))
      .output(z.object({ ok: z.literal(true) })),
    saveModelSettings: oc.input(ModelSettingsSaveSchema).output(z.object({ ok: z.literal(true) })),
    disconnect: oc
      .input(z.object({ provider: z.string().trim().min(1), credentialId: Id.optional() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  bots: {
    list: oc.output(z.array(BotSchema)),
    listArchived: oc.output(z.array(BotSchema)),
    get: oc.input(botId).output(BotSchema),
    create: oc.input(CreateBotInput).output(BotSchema),
    importPreview: oc.input(AgentImportPreviewInput).output(AgentImportPlanSchema),
    importCreate: oc.input(AgentImportCreateInput).output(BotSchema),
    importSetupState: oc.input(AgentImportSetupStateInput).output(AgentImportSetupStateSchema),
    templates: oc.output(z.array(BotTemplateListingSchema)),
    createFromTemplate: oc.input(CreateBotFromTemplateInput).output(CreateBotFromTemplateOutput),
    exportPackage: oc.input(ExportBotPackageInput).output(BotPackageSchema),
    duplicate: oc.input(botId).output(BotSchema),
    reorder: oc.input(ReorderBotsInput).output(z.object({ ok: z.literal(true) })),
    update: oc.input(UpdateBotInput).output(BotSchema),
    restoreInstructions: oc
      .input(
        z.object({
          botId: Id,
          versionId: Id,
          expectedInstructions: z.string(),
          undo: z.boolean().optional(),
        }),
      )
      .output(BotSchema),
    setComputer: oc.input(z.object({ botId: Id, mode: ComputerModeSchema })).output(BotSchema),
    archive: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    remove: oc.input(z.object({ botId: Id, deleteMemories: z.boolean().default(false) })).output(
      z.object({
        ok: z.literal(true),
        removedGroupIds: z.array(Id).optional(),
        alreadyRemoved: z.boolean().optional(),
      }),
    ),
    removePreview: oc.input(botId).output(z.array(z.object({ id: Id, name: z.string() }))),
    emailAddress: oc.input(botId).output(BotEmailAddressSchema),
    emailAddresses: oc.output(BotEmailAddressesSchema),
    claimEmailAddress: oc
      .input(z.object({ botId: Id, name: BotEmailNameSchema }))
      .output(z.object({ address: z.string() })),
    rotateWebhookSecret: oc.input(botId).output(
      z.object({
        secret: z.string(),
        path: z.string(),
        webhookConfigured: z.literal(true),
      }),
    ),
    revealWebhookSecret: oc.input(botId).output(z.object({ secret: z.string() })),
  },
  groups: {
    create: oc.input(CreateGroupInput).output(GroupSchema),
    list: oc.output(z.array(GroupSchema)),
    listArchived: oc.output(z.array(GroupSchema)),
    get: oc.input(groupId).output(GroupDetailSchema),
    duplicate: oc.input(groupId).output(GroupSchema),
    update: oc.input(UpdateGroupInput).output(GroupSchema),
    archive: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    restore: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
    remove: oc.input(groupId).output(z.object({ ok: z.literal(true) })),
  },
  botSections: {
    list: oc.output(z.array(BotSectionSchema)),
    create: oc.input(threadTarget.safeExtend({ name: BotSectionName })).output(BotSectionSchema),
    update: oc.input(z.object({ sectionId: Id, name: BotSectionName })).output(BotSectionSchema),
    remove: oc.input(z.object({ sectionId: Id })).output(
      z.object({
        id: Id,
        releasedBots: z.number().int().nonnegative(),
        releasedGroups: z.number().int().nonnegative(),
      }),
    ),
  },
  threads: {
    head: oc.input(threadTarget).output(
      z.object({
        threadId: Id,
        cursor: z.number().int().min(-1),
      }),
    ),
    get: oc.input(threadTarget).output(ThreadSnapshotSchema),
    messages: oc
      .input(
        threadTarget.safeExtend({
          before: z.number().int().nonnegative().optional(),
          includePeerRuns: z.boolean().optional(),
          includePeerReceipts: z.boolean().optional(),
          around: z
            .object({
              messageId: Id.optional(),
              seq: z.number().int().nonnegative().optional(),
            })
            .optional(),
        }),
      )
      .output(ThreadMessagePageSchema),
    subscribe: oc
      .input(threadTarget.safeExtend({ cursor: z.number().int().min(-1) }))
      .output(eventIterator(ProductEventSchema)),
    send: oc.input(threadSendInput).output(threadSendOutput),
    sendWithRoutines: oc
      .input(threadSendWithRoutinesInput)
      .output(z.object({ routineRunIds: z.array(Id), send: threadSendOutput.optional() })),
    react: oc
      .input(
        threadTarget.safeExtend({
          messageId: Id,
          reaction: MessageReactionSchema,
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(z.object({ ok: z.literal(true), runIds: z.array(Id).optional() })),
    stop: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    stopHelper: oc
      .input(threadTarget.safeExtend({ messageId: Id }))
      .output(z.object({ ok: z.literal(true) })),
    followUp: oc
      .input(
        threadTarget.safeExtend({
          text: z.string().min(1),
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    endCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          durationSeconds: z
            .number()
            .int()
            .nonnegative()
            .max(7 * 24 * 60 * 60)
            .optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    answerCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
        }),
      )
      .output(z.object({ opening: z.string(), reason: z.string() })),
    declineCall: oc
      .input(
        botId.safeExtend({
          callId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^:]+$/),
          outcome: z.enum(["declined", "missed"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    clear: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    answer: oc
      .input(
        threadTarget
          .safeExtend({
            runId: Id,
            messageId: Id,
            answer: z.string(),
            clientNonce: z.string().min(1).max(200).optional(),
            fields: z.array(LoginFieldInput).min(1).max(LOGIN_FIELD_LIMIT).optional(),
            username: z.string().min(1).max(512).optional(),
            remember: z.literal(false).optional(),
            dismiss: z.literal(true).optional(),
          })
          .refine(
            (input) => input.remember === undefined || Boolean(input.fields ?? input.username),
            {
              message: "Only a website login can be used without saving it",
              path: ["remember"],
            },
          )
          .refine(
            (input) =>
              input.dismiss
                ? input.answer === "" && !input.username && !input.fields && !input.clientNonce
                : input.fields
                  ? input.answer === "" && !input.username
                  : input.answer.length > 0,
            "Send either an answer or a dismissal",
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    markRead: oc
      .input(threadTarget)
      .output(z.object({ ok: z.literal(true), unreadAfterSeq: z.number().int().nullable() })),
    markUnread: oc
      .input(threadTarget.and(z.object({ messageId: Id.optional() })))
      .output(z.object({ ok: z.literal(true) })),
    snooze: oc
      .input(threadTarget.and(z.object({ until: z.iso.datetime({ offset: true }).nullable() })))
      .output(z.object({ ok: z.literal(true) })),
  },
  computer: {
    status: oc.input(botId).output(ComputerStatusSchema),
    boot: oc.input(botId).output(ComputerStatusSchema),
    stop: oc.input(botId).output(ComputerStatusSchema),
    recover: oc.input(botId).output(ComputerUpdateSchema),
    reset: oc.input(botId).output(ComputerStatusSchema),
    update: oc.input(botId).output(ComputerUpdateSchema),
    updates: oc.output(z.array(ComputerUpdateSchema)),
    releaseInterrupted: oc
      .input(z.object({ id: Id, workersStopped: z.literal(true) }))
      .output(z.object({ ok: z.literal(true) })),
    dismissUpdate: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    dismissDiskWarning: oc.input(botId).output(z.object({ ok: z.literal(true) })),
    takeover: oc.input(botId).output(z.object({ leaseId: Id, expiresAt: z.string() })),
    release: oc
      .input(
        z.object({
          botId: Id,
          reason: ComputerReleaseReasonSchema.optional(),
          runId: Id.optional(),
          leaseId: Id.optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    input: oc
      .input(
        z.object({
          botId: Id,
          kind: z.enum(["key", "pointer", "clipboard", "scroll"]),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    files: oc
      .input(z.object({ botId: Id, path: z.string().default("/") }))
      .output(
        z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number() })),
      ),
    readFile: oc
      .input(z.object({ botId: Id, path: z.string() }))
      .output(z.object({ path: z.string(), content: z.string() })),
    downloadFile: oc
      .input(z.object({ botId: Id, path: z.string().min(1) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    uploadFile: oc
      .input(
        z.object({
          botId: Id,
          path: z.string().min(1),
          contentBase64: z.string(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    terminalUrl: oc.input(botId).output(z.object({ url: z.string().nullable() })),
    commands: oc
      .input(botId)
      .output(z.array(ComputerCommandSchema.extend({ createdAt: z.string() }))),
    screenUrl: oc.input(botId).output(ComputerScreenSchema),
    hostBrowserProfiles: oc
      .input(botId)
      .output(z.object({ profiles: z.array(HostBrowserProfileSchema) })),
    importHostBrowserSessions: oc
      .input(
        z.object({
          botId: Id,
          profile: z.string().min(1).max(512),
          sites: z.array(z.string().min(1).max(253)).min(1).max(50),
        }),
      )
      .output(HostBrowserImportSchema),
    preview: oc
      .input(
        z.object({
          botId: Id,
          runId: Id.optional(),
        }),
      )
      .output(z.object({ image: z.string().nullable() })),
    heartbeat: oc.input(botId).output(z.object({ ok: z.literal(true) })),
  },
  memory: {
    list: oc
      .input(z.object({ botId: Id.optional(), scope: z.enum(["bot", "user"]).optional() }))
      .output(z.array(MemoryDocumentSchema)),
    budget: oc.input(z.object({ botId: Id })).output(MemoryPromptBudgetSchema),
    update: oc
      .input(
        z.object({
          documentId: Id,
          content: z.string(),
          expectedRevision: z.number().int().positive().optional(),
        }),
      )
      .output(MemoryDocumentSchema),
    remove: oc.input(z.object({ documentId: Id })).output(z.object({ ok: z.literal(true) })),
    exportMarkdown: oc.input(z.object({ botId: Id.optional() })).output(z.string()),
    providerConfig: oc.output(SpaceMemoryConfigSchema.nullable()),
    connectProvider: oc
      .input(
        z.object({
          provider: z.string().min(1),
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()),
          defaultMemoryScope: MemoryScopeSchema.default("isolated"),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    setDefaultScope: oc
      .input(z.object({ defaultMemoryScope: MemoryScopeSchema }))
      .output(SpaceMemoryConfigSchema),
    updateProvider: oc
      .input(
        z.object({
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()).default({}),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    disconnectProvider: oc.output(z.object({ ok: z.literal(true) })),
  },
  routines: {
    listForMentions: oc
      .input(z.object({ botIds: z.array(Id).min(1).max(ROUTINE_MENTION_BATCH_MAX) }))
      .output(z.array(z.object({ botId: Id, routines: z.array(RoutineSchema) }))),
    list: oc.input(botId).output(z.array(RoutineSchema)),
    history: oc
      .input(
        z.object({
          routineId: Id,
          before: RoutineRunCursorSchema.optional(),
          limit: z.number().int().min(1).max(ROUTINE_HISTORY_PAGE_SIZE).optional(),
        }),
      )
      .output(RoutineHistorySchema),
    create: oc.input(CreateRoutineInput).output(RoutineSchema),
    update: oc
      .input(
        z
          .object({
            routineId: Id,
            name: z.string().optional(),
            prompt: z.string().optional(),
            crons: z.array(z.string().min(1)).optional(),
            timezone: TimeZoneSchema.optional(),
            active: z.boolean().optional(),
            notify: z.boolean().optional(),
            webhookEnabled: z.boolean().optional(),
            githubEnabled: z.boolean().optional(),
            messageProvider: z
              .string()
              .min(1)
              .max(50)
              .regex(/^[a-z0-9._-]+$/i)
              .nullable()
              .optional(),
            emailSenders: RoutineEmailSendersSchema.nullable().optional(),
            modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
            modelId: z.string().trim().min(1).max(200).nullable().optional(),
            thinkingLevel: ThinkingLevelSchema.nullable().optional(),
            runAt: IsoDate.optional(),
            watch: RoutineWatchSchema.nullable().optional(),
          })
          .superRefine((value, ctx) => {
            if (
              value.crons &&
              value.crons.length === 0 &&
              value.webhookEnabled === false &&
              value.githubEnabled === false &&
              value.messageProvider === null &&
              value.emailSenders === null &&
              value.watch === null
            ) {
              ctx.addIssue({
                code: "custom",
                message: ROUTINE_TRIGGER_REQUIRED,
                path: ["crons"],
              });
            }
          }),
      )
      .output(RoutineSchema),
    remove: oc.input(z.object({ routineId: Id })).output(z.object({ ok: z.literal(true) })),
    testRun: oc
      .input(
        z.object({
          routineId: Id,
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ runId: Id })),
  },
  scratchpad: {
    list: oc
      .input(
        z.object({
          botId: Id,
          status: ScratchpadItemStatusSchema.optional(),
          includeDone: z.boolean().optional(),
        }),
      )
      .output(z.array(ScratchpadItemSchema)),
    create: oc.input(CreateScratchpadItemInput).output(ScratchpadItemSchema),
    update: oc
      .input(
        z.object({
          itemId: Id,
          title: z.string().min(1).max(200).optional(),
          status: ScratchpadItemStatusSchema.optional(),
          notes: z.string().max(4_000).optional(),
        }),
      )
      .output(ScratchpadItemSchema),
    remove: oc.input(z.object({ itemId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  email: {
    mailboxes: oc.output(EmailMailboxesSchema),
    messages: oc.input(EmailMessagesInput).output(EmailMessagesPageSchema),
    message: oc.input(z.object({ id: Id })).output(EmailMessageSchema),
  },
  docs: {
    list: oc.output(z.array(DocSchema)),
    create: oc.input(CreateDocInput).output(DocSchema),
    revisions: oc.input(z.object({ documentId: Id })).output(z.array(DocRevisionSchema)),
  },
  boards: {
    list: oc.output(z.array(BoardSchema)),
    get: oc.output(BoardSchema),
    rename: oc.input(RenameBoardInput).output(BoardSchema),
    subscribe: oc.output(eventIterator(BoardEventSchema)),
  },
  tickets: {
    list: oc.input(ListTicketsInput).output(ListTicketsOutput),
    get: oc.input(GetTicketInput).output(TicketSchema),
    create: oc.input(CreateTicketInput).output(TicketSchema),
    update: oc.input(UpdateTicketInput).output(TicketSchema),
    move: oc.input(MoveTicketInput).output(TicketSchema),
    comment: oc.input(CommentTicketInput).output(TicketCommentSchema),
    comments: oc.input(z.object({ ticketId: Id })).output(z.array(TicketCommentSchema)),
  },
  skills: {
    list: oc.input(botId).output(z.array(TaughtSkillSchema)),
    get: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    start: oc
      .input(z.object({ botId: Id, goal: z.string().min(1).max(4000) }))
      .output(TaughtSkillSchema),
    appendEvent: oc
      .input(z.object({ skillId: Id, event: TeachRecordingEventSchema }))
      .output(TaughtSkillSchema),
    snapshot: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    stop: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    updateDraft: oc
      .input(
        z.object({
          skillId: Id,
          name: z.string().optional(),
          playbook: SkillPlaybookSchema,
        }),
      )
      .output(TaughtSkillSchema),
    save: oc
      .input(z.object({ skillId: Id, name: z.string().optional() }))
      .output(TaughtSkillSchema),
    testRun: oc
      .input(z.object({ skillId: Id, prompt: z.string().optional() }))
      .output(z.object({ runId: Id })),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  agentSkills: {
    list: oc.output(z.array(AgentSkillCatalogEntrySchema)),
    get: oc
      .input(
        z
          .object({ skillId: Id.optional(), name: z.string().min(1).max(80).optional() })
          .superRefine((input, ctx) => {
            if (!input.skillId && !input.name?.trim()) {
              ctx.addIssue({
                code: "custom",
                message: "Provide skillId or name",
                path: ["skillId"],
              });
            }
          }),
      )
      .output(AgentSkillSchema),
    create: oc.input(CreateAgentSkillInput).output(AgentSkillSchema),
    update: oc.input(UpdateAgentSkillInput).output(AgentSkillSchema),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  availability: {
    set: oc
      .input(z.object({ kind: AvailabilityKindSchema, id: Id }).and(SpaceAvailabilitySchema))
      .output(SpaceAvailabilitySchema),
    items: oc.output(z.array(AccountItemSchema)),
    chooseForSpace: oc
      .input(
        z.object({
          spaceId: Id,
          items: z.array(z.object({ kind: AvailabilityKindSchema, id: Id })).max(500),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  marketplace: {
    catalog: oc
      .input(z.object({ query: z.string().trim().max(200).default("") }))
      .output(PluginMarketplaceCatalogSchema),
    submissions: oc
      .input(z.object({ status: PluginSubmissionStatusSchema.default("pending") }))
      .output(z.array(PluginSubmissionSchema)),
    review: oc.input(PluginSubmissionReviewSchema).output(PluginSubmissionSchema),
  },
  capabilities: {
    list: oc.output(z.array(CapabilityInstallSchema)),
    sourcePresets: oc.output(z.array(McpSourcePresetSchema)),
    catalogSearch: oc
      .input(
        z.object({
          query: z.string().trim().max(CATALOG_SEARCH_QUERY_MAX_LENGTH).default(""),
          usePublicCatalog: z.boolean().default(false),
        }),
      )
      .output(
        z.object({
          enabled: z.boolean(),
          results: z.array(IntegrationCatalogResultSchema),
        }),
      ),
    install: oc
      .input(
        z.object({
          kind: z.enum(["skill", "plugin", "mcp", "api", "graphql"]),
          name: z.string().min(1).max(120),
          source: z.string().min(1).max(2048),
          config: z.record(z.string(), z.unknown()).default({}),
          credential: z.string().max(16_384).optional(),
          pluginDigest: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .optional(),
          pluginParts: z.array(PluginPartSchema).min(1).max(2).optional(),
          acceptRisk: z.boolean().default(false),
        }),
      )
      .output(CapabilityInstallSchema),
    pluginParts: oc
      .input(
        z.object({
          id: Id,
          parts: z.array(PluginPartSchema).max(2),
          acceptRisk: z.boolean().default(false),
        }),
      )
      .output(z.object({ install: CapabilityInstallSchema.nullable() })),
    pluginPreview: oc
      .input(z.object({ source: z.string().min(1).max(2048) }))
      .output(PluginPreviewSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  mcp: {
    servers: {
      list: oc.output(z.array(McpServerSchema)),
      create: oc.input(McpServerConfigInput).output(McpServerSchema),
      update: oc
        .input(
          z.union([
            z.object({ id: Id, config: McpServerConfigInput }),
            z.object({ id: Id, secret: z.string().min(1).max(16384) }),
          ]),
        )
        .output(McpServerSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
      test: oc.input(z.object({ id: Id })).output(McpServerSchema),
      tools: oc.input(z.object({ id: Id })).output(z.array(ConnectionToolSchema)),
      agents: oc
        .input(z.object({ id: Id, allBots: z.boolean(), botIds: z.array(Id).max(500).default([]) }))
        .output(z.object({ server: McpServerSchema, assignments: z.array(BotMcpServerSchema) })),
    },
    assignments: {
      list: oc.input(botId).output(z.array(BotMcpServerSchema)),
      all: oc.output(z.array(BotMcpServerSchema)),
      approve: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(BotMcpServerSchema),
      dismiss: oc
        .input(z.object({ botId: Id, serverId: Id, threadId: Id.optional() }))
        .output(z.object({ ok: z.literal(true) })),
      replace: oc
        .input(
          z.object({
            botId: Id,
            assignments: z.array(
              z.object({
                serverId: Id,
                allowAllTools: z.boolean().default(true),
                allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
              }),
            ),
          }),
        )
        .output(z.array(BotMcpServerSchema)),
    },
    oauth: {
      begin: oc.input(z.object({ serverId: Id, redirectUri: z.string().url().optional() })).output(
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("authorization_required"),
            sessionId: Id,
            authorizationUrl: z.string().url(),
          }),
          z.object({
            status: z.enum(["already_connected", "authorization_not_requested"]),
          }),
        ]),
      ),
      complete: oc
        .input(z.object({ sessionId: Id, code: z.string().min(1), state: z.string().min(1) }))
        .output(z.object({ ok: z.literal(true) })),
      disconnect: oc.input(z.object({ serverId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  onboarding: {
    signupSurvey: oc.input(SignupSurveySchema).output(z.object({ ok: z.literal(true) })),
    start: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    promptFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    choose: oc
      .input(z.object({ botId: Id, optionId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    dismissFocus: oc.input(z.object({ botId: Id })).output(z.object({ ok: z.literal(true) })),
    appConnected: oc
      .input(
        z.object({
          botId: Id,
          threadId: Id.optional(),
          messageId: Id.optional(),
          provider: z.string(),
          connectorId: z.string().default("composio"),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  integrationSetup: {
    get: oc.output(IntegrationSetupStateSchema),
    save: oc.input(IntegrationProviderConfigSchema).output(z.object({ ok: z.literal(true) })),
  },
  connections: {
    catalog: oc
      .input(z.object({ query: z.string().optional(), connectorId: z.string().optional() }))
      .output(z.array(ConnectionCatalogItemSchema)),
    list: oc.output(z.array(ConnectionSchema)),
    begin: oc
      .input(
        z.object({
          connectorId: z.string().default("composio"),
          provider: z.string(),
          displayName: z.string(),
        }),
      )
      .output(z.object({ connectionId: Id, authorizationUrl: z.string().nullable() })),
    complete: oc
      .input(z.object({ connectionId: Id, code: z.string().optional() }))
      .output(ConnectionSchema),
    rename: oc
      .input(
        z.object({
          connectionId: Id,
          displayName: z.string().trim().min(1).max(CONNECTION_LABEL_MAX_LENGTH),
        }),
      )
      .output(ConnectionSchema),
    revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    tools: oc
      .input(z.object({ connectorId: z.string(), provider: z.string() }))
      .output(z.array(ConnectionToolSchema)),
  },
  messaging: {
    installations: {
      list: oc.output(MessagingInstallationsStatusSchema),
      start: oc.input(z.object({ botId: Id.optional() })).output(z.object({ url: z.string() })),
      complete: oc
        .input(z.object({ state: z.string().max(64), code: z.string().max(4096) }))
        .output(z.object({ ok: z.literal(true) })),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    },
    status: oc.output(MessagingStatusSchema),
    link: {
      start: oc.input(z.object({ botId: Id })).output(
        z.object({
          code: z.string(),
          expiresAt: z.string(),
          shared: z.boolean().optional(),
        }),
      ),
    },
    identities: {
      setBot: oc
        .input(z.object({ identityId: Id, botId: Id }))
        .output(MessagingLinkedIdentitySchema),
      unlink: oc.input(z.object({ identityId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    channels: {
      list: oc.output(z.array(MessagingChannelMembershipSchema)),
      respond: oc
        .input(z.object({ membershipId: Id, accept: z.boolean() }))
        .output(MessagingChannelMembershipSchema),
      leave: oc.input(z.object({ membershipId: Id })).output(z.object({ ok: z.literal(true) })),
    },
    connections: {
      list: oc.output(z.array(MessagingAgentConnectionSchema)),
      respond: oc
        .input(z.object({ connectionId: Id, accept: z.boolean() }))
        .output(MessagingAgentConnectionSchema),
      revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  approvalRules: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(ActionApprovalRuleSchema)),
    set: oc
      .input(
        settingsScopeInput.extend({
          effect: z.enum(["always_allow", "require_approval", "deny"]),
          matchKind: z.enum(["tool", "connector", "site"]),
          matchValue: z.string().trim().min(1),
        }),
      )
      .output(ActionApprovalRuleSchema),
    remove: oc
      .input(settingsScopeInput.extend({ id: Id }))
      .output(z.object({ ok: z.literal(true) })),
  },
  actionRules: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(ActionRuleSchema)),
    set: oc
      .input(settingsScopeInput.extend({ rules: ActionRuleListSchema }))
      .output(z.array(ActionRuleSchema)),
  },
  trustedLinkSites: {
    list: oc.output(z.array(z.string())),
    trust: oc
      .input(z.object({ url: z.string().min(1).max(8192) }))
      .output(z.object({ site: z.string() })),
    remove: oc
      .input(z.object({ site: z.string().min(1).max(253) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  autoReview: {
    get: oc.input(settingsScopeInput.optional()).output(ActionAutoReviewSettingsSchema),
    set: oc
      .input(
        settingsScopeInput.extend({
          mode: ApprovalModeSchema.optional(),
          enabled: z.boolean().optional(),
          skipApprovals: z.boolean().optional(),
        }),
      )
      .output(ActionAutoReviewSettingsSchema),
  },
  spaceSettings: {
    overrides: oc.output(z.array(SpaceSettingSchema)),
    setOverride: oc
      .input(z.object({ setting: SpaceSettingSchema, enabled: z.boolean() }))
      .output(z.array(SpaceSettingSchema)),
  },
  artifacts: {
    list: oc.input(botId).output(z.array(ArtifactSchema)),
    listSpace: oc
      .input(
        z.object({
          botId: Id.optional(),
          madeByBots: z.boolean().optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(ArtifactSchema.extend({ versionCount: z.number().int() })),
          nextCursor: z.string().nullable(),
        }),
      ),
    listVersions: oc.input(z.object({ familyId: Id })).output(z.array(ArtifactVersionSchema)),
    create: oc
      .input(
        threadTarget.and(
          z.object({
            name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
            description: z.string().max(ARTIFACT_DESCRIPTION_MAX_LENGTH).optional(),
            mimeType: z.string().min(1),
            contentBase64: z.string().min(1),
            clientNonce: z.string().min(1).max(200).optional(),
          }),
        ),
      )
      .output(ArtifactSchema),
    get: oc.input(threadTarget.and(z.object({ artifactId: Id }))).output(ArtifactWithContentSchema),
    getById: oc.input(z.object({ artifactId: Id })).output(ArtifactWithContentSchema),
    remove: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  pages: {
    list: oc
      .input(
        z.strictObject({
          botId: Id.optional(),
          groupId: Id.optional(),
          cursor: z.string().max(500).optional(),
          limit: z.number().int().min(1).max(PAGE_LIST_MAX_LIMIT).optional(),
          query: z.string().trim().min(1).max(200).optional(),
        }),
      )
      .output(
        z.strictObject({ items: z.array(PageSummarySchema), nextCursor: z.string().nullable() }),
      ),
    get: oc
      .input(
        z.strictObject({
          pageId: Id,
          version: z.number().int().positive().optional(),
          link: z.boolean().optional(),
        }),
      )
      .output(PageDetailSchema),
    rename: oc
      .input(z.strictObject({ pageId: Id, title: PageTitleSchema }))
      .output(PageSummarySchema),
    setVisibility: oc
      .input(z.strictObject({ pageId: Id, visibility: PageVisibilitySchema }))
      .output(
        z.strictObject({ visibility: PageVisibilitySchema, shareUrl: z.string().nullable() }),
      ),
    pin: oc.input(z.strictObject({ pageId: Id, pinned: z.boolean() })).output(PageSummarySchema),
    remove: oc.input(z.strictObject({ pageId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  usage: {
    list: oc.output(z.array(UsageRecordSchema)),
    summary: oc.output(UsageSummarySchema),
    limits: oc.output(z.array(PlanLimitsSchema)),
  },
  export: {
    bot: oc.input(botId).output(ExportManifestSchema),
    accountToken: oc.output(z.object({ token: z.string() })),
  },
  notifications: {
    subscribe: oc.output(
      eventIterator(
        z.object({
          type: z.enum(["alert", "roster", ...SpaceChangeKind.options, "heartbeat"]),
          alert: ChatAlertSchema.optional(),
        }),
      ),
    ),
    subscribeCalls: oc.output(
      eventIterator(
        z.object({
          type: z.enum(["incoming.calls", "heartbeat"]),
          payload: z.object({ calls: z.array(IncomingBotCallSchema) }).optional(),
        }),
      ),
    ),
    declineIncomingCall: oc
      .input(z.object({ callId: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    registerCallPush: oc
      .input(
        z
          .object({
            deviceId: z.string().uuid(),
            platform: z.enum(["ios", "android"]),
            expoToken: z.string().min(8).max(512).regex(/^\S+$/).optional(),
            voipToken: z
              .string()
              .regex(/^[a-fA-F0-9]{64,200}$/)
              .optional(),
          })
          .refine((value) =>
            Boolean(value.expoToken || (value.platform === "ios" && value.voipToken)),
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    registerPush: oc
      .input(
        z.object({
          token: z.string().min(8).max(512).regex(/^\S+$/),
          presentation: z.literal("android_sender").optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    unregisterPush: oc.output(z.object({ ok: z.literal(true) })),
    followWorkActivity: oc
      .input(
        z.object({
          token: z
            .string()
            .regex(/^[a-fA-F0-9]{64,512}$/)
            .optional(),
        }),
      )
      .output(z.object({ following: z.boolean() })),
    registerWorkActivityStarts: oc
      .input(z.object({ token: z.string().regex(/^[a-fA-F0-9]{64,512}$/) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  search: {
    query: oc.input(z.object({ q: z.string().max(200) })).output(SearchQueryOutputSchema),
  },
  links: {
    favicon: oc
      .input(z.object({ origin: z.string().max("https://".length + 253 + ":65535".length) }))
      .output(z.object({ icon: z.string().nullable(), retry: z.boolean().optional() })),
  },
  runs: {
    list: oc.input(z.object({ filter: z.enum(["active", "recent"]) })).output(RunsListOutputSchema),
  },
  spendingLimit: {
    get: oc.output(SpendingStatusSchema),
    set: oc
      .input(z.object({ limit: SpendingLimitSchema.nullable() }).strict())
      .output(SpendingStatusSchema),
    payments: oc.output(z.array(SpendingPaymentSchema)),
  },
  paymentWallet: {
    status: oc.output(PaymentWalletStatusSchema),
    connect: oc.output(PaymentWalletStatusSchema),
    disconnect: oc.output(PaymentWalletStatusSchema),
  },
  voice: {
    catalog: oc.output(z.array(VoiceCatalogEntrySchema)),
    status: oc.input(settingsScopeInput.optional()).output(VoiceStatusSchema),
    credentials: oc.input(settingsScopeInput.optional()).output(z.array(VoiceCredentialSchema)),
    connect: oc
      .input(
        z
          .object({
            provider: z.string(),
            apiKey: z.string().max(4096).default(""),
            voiceId: z.string().max(120).optional(),
            speechModel: z.string().max(64).optional(),
            baseUrl: z.string().max(2048).optional(),
            sttBaseUrl: z.string().max(2048).optional(),
            sttApiKey: z.string().max(4096).optional(),
            ttsModel: z.string().max(200).optional(),
            sttModel: z.string().max(200).optional(),
            scope: SettingsScopeSchema.optional(),
          })
          .superRefine((input, ctx) => {
            if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID && !input.baseUrl?.trim()) {
              ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Enter a server URL." });
            }
          }),
      )
      .output(VoiceCredentialSchema),
    disconnect: oc
      .input(z.object({ provider: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
    setVoice: oc
      .input(
        settingsScopeInput.extend({
          voiceId: z.string().min(1).max(120),
          provider: z.string().optional(),
        }),
      )
      .output(VoiceStatusSchema),
    setSpeechModel: oc
      .input(
        settingsScopeInput.extend({
          provider: z.string().min(1),
          speechModel: z.string().max(64),
        }),
      )
      .output(VoiceCredentialSchema),
    voices: oc
      .input(
        settingsScopeInput.extend({
          provider: z.string().optional(),
          language: z.string().max(35).optional(),
        }),
      )
      .output(z.array(VoiceInfoSchema)),
    prepare: oc
      .input(
        z.object({
          text: z.string().max(20000),
          voiceId: z.string().max(120).optional(),
          botId: Id.optional(),
          scope: SettingsScopeSchema.optional(),
        }),
      )
      .output(z.object({ ready: z.boolean(), utterances: z.array(z.string()) })),
  },
  externalConversations: {
    updatePolicy: oc
      .input(UpdateExternalConversationPolicyInput)
      .output(ExternalConversationPolicySchema),
  },
  agentSecrets: {
    list: oc.output(z.array(AgentSecretSchema)),
    put: oc.input(AgentSecretInputSchema).output(AgentSecretSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  vault: {
    list: oc.input(settingsScopeInput.optional()).output(z.array(BotSecretMetadata)),
    put: oc.input(VaultPutInput).output(BotSecretMetadata),
    reveal: oc.input(VaultRevealInput).output(VaultRevealed),
    import: oc.input(VaultImportInput).output(VaultImportResult),
    activity: oc
      .input(settingsScopeInput.extend({ name: StoredBotSecretName }))
      .output(z.array(VaultUse).max(VAULT_ACTIVITY_LIMIT)),
    remove: oc
      .input(settingsScopeInput.extend({ name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
  botSecrets: {
    list: oc.input(z.object({ botId: Id })).output(z.array(BotSecretMetadata)),
    put: oc.input(BotSecretPutInput).output(BotSecretMetadata),
    remove: oc
      .input(z.object({ botId: Id, name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

export type AppContract = typeof appContract;

type ProcedurePaths<Router, Prefix extends string = ""> = {
  [Key in keyof Router & string]: Router[Key] extends AnyContractProcedure
    ? `${Prefix}${Key}`
    : ProcedurePaths<Router[Key], `${Prefix}${Key}/`>;
}[keyof Router & string];

type AtPath<Tree, Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends keyof Tree
    ? AtPath<Tree[Head], Rest>
    : never
  : Path extends keyof Tree
    ? Tree[Path]
    : never;

export type RpcPath = ProcedurePaths<AppContract>;
type RpcInputs = { [Path in RpcPath]: AtPath<InferContractRouterInputs<AppContract>, Path> };
type RpcOutputs = { [Path in RpcPath]: AtPath<InferContractRouterOutputs<AppContract>, Path> };
export type RpcInput<Path extends RpcPath> = RpcInputs[Path];
export type RpcOutput<Path extends RpcPath> = RpcOutputs[Path];
