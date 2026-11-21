import type { AgentRunRequest, SecretStore } from "@robots/adapter-kit";
import type {
  ModelRole,
  ModelRoleChoice,
  ModelRoleSettings,
  SettingsScope,
} from "@robots/contracts";
import {
  backupChoiceKey,
  canonicalPiProviderId,
  ThinkingLevelSchema,
  usableModelId,
} from "@robots/contracts";
import { pickCatalogModelId } from "@robots/core";
import type { PrismaClient } from "@robots/db";
import { appliedModelRole, comparePreferenceOrder, newestModelCredentialOrder } from "@robots/db";
import { resolveAutoReviewChecker } from "./auto-review.js";
import type { ModelChoice, ModelCredential } from "./model-selection.js";
import { findConnectedModelCredential } from "./model-selection.js";
import { listPiCatalog } from "./pi-models.js";

export type DeploymentModelDefaults = {
  settings?: { defaultModelProvider: string | null; defaultModelId: string | null } | null;
  deployment?: { provider: string; model: string } | null;
  env?: NodeJS.ProcessEnv;
};

export function deploymentModelRole(
  role: ModelRole,
  defaults: DeploymentModelDefaults,
): ModelRoleSettings {
  if (role === "approval") {
    const checker = resolveAutoReviewChecker(defaults.env);
    return {
      primary: checker ? { provider: checker.provider, modelId: checker.model } : null,
      backups: [],
    };
  }
  if (role === "computer") return { primary: null, backups: [] };
  const provider = defaults.settings?.defaultModelProvider ?? defaults.deployment?.provider;
  const modelId =
    usableModelId(defaults.settings?.defaultModelId) ?? usableModelId(defaults.deployment?.model);
  return { primary: provider && modelId ? { provider, modelId } : null, backups: [] };
}

export type EffectiveModelRole = ModelRoleSettings & {
  primarySource: "member" | "deployment" | null;
};

export async function effectiveModelRole(
  prisma: Pick<
    PrismaClient,
    "spaceModelRoleChoice" | "userModelRoleChoice" | "spaceSettingOverride"
  >,
  scope: { userId: string; spaceId: string },
  role: ModelRole,
  defaults: DeploymentModelDefaults,
  requested?: SettingsScope,
): Promise<EffectiveModelRole> {
  const own = await appliedModelRole(prisma, scope, role, requested);
  if (own.primary) return { ...own, primarySource: "member" };
  const deployment = deploymentModelRole(role, defaults);
  return {
    primary: deployment.primary,
    backups: own.backups.length ? own.backups : deployment.backups,
    primarySource: deployment.primary ? "deployment" : null,
  };
}

export type MemberMainModel = ModelRoleChoice & {
  credential: ModelCredential;
};

type MainModelClient = Pick<
  PrismaClient,
  "spaceModelRoleChoice" | "userModelRoleChoice" | "spaceSettingOverride" | "userModelCredential"
>;

export async function memberMainChoice(
  prisma: MainModelClient,
  scope: { userId: string; spaceId: string },
): Promise<ModelRoleChoice | null> {
  const { primary } = await appliedModelRole(prisma, scope, "main");
  return primary ?? (await connectedModelChoice(prisma, scope));
}

async function connectedModelChoice(
  prisma: Pick<PrismaClient, "userModelCredential">,
  scope: { userId: string },
): Promise<ModelRoleChoice | null> {
  const credentials = await prisma.userModelCredential.findMany({
    where: { userId: scope.userId },
    orderBy: newestModelCredentialOrder,
    select: {
      id: true,
      provider: true,
      userPreferences: {
        where: { userId: scope.userId },
        select: { credentialId: true, modelId: true, thinkingLevel: true, updatedAt: true },
      },
    },
  });
  const preferred = credentials
    .flatMap((credential) =>
      (credential.userPreferences ?? []).flatMap((preference) => {
        const modelId = usableModelId(preference.modelId);
        return modelId ? [{ ...preference, modelId, provider: credential.provider }] : [];
      }),
    )
    .sort(comparePreferenceOrder)[0];
  if (preferred) {
    const thinkingLevel = ThinkingLevelSchema.safeParse(preferred.thinkingLevel);
    return {
      provider: canonicalPiProviderId(preferred.provider),
      modelId: preferred.modelId,
      credentialId: preferred.credentialId,
      ...(thinkingLevel.success ? { thinkingLevel: thinkingLevel.data } : {}),
    };
  }
  const runnable = listPiCatalog().filter((entry) => !entry.placeholder);
  for (const credential of credentials) {
    const modelId = pickCatalogModelId(runnable, credential.provider);
    if (modelId)
      return {
        provider: canonicalPiProviderId(credential.provider),
        modelId,
        credentialId: credential.id,
      };
  }
  return null;
}

export async function resolveMemberMainModel(
  deps: { prisma: PrismaClient; secretStore: Pick<SecretStore, "load"> },
  scope: { userId: string; spaceId: string },
): Promise<MemberMainModel | null> {
  const primary = await memberMainChoice(deps.prisma, scope);
  if (!primary) return null;
  const credential = await findConnectedModelCredential(
    deps.prisma,
    deps.secretStore,
    scope,
    primary.provider,
    primary.modelId,
    { credentialId: primary.credentialId },
  );
  return { ...primary, credential };
}

export function selectConfiguredModel(input: {
  override: ModelChoice | null;
  hostedProvider?: string;
  overrideCredential: ModelCredential;
  main: MemberMainModel | null;
  defaults: DeploymentModelDefaults;
}) {
  const { override: bot, overrideCredential, main } = input;
  const hasOverride = Boolean(bot?.modelProvider && usableModelId(bot.modelId));
  const runnable = (provider: string | null | undefined, credential: ModelCredential) =>
    Boolean(credential || (provider && provider === input.hostedProvider));
  const useOverride = hasOverride && runnable(bot?.modelProvider, overrideCredential);
  const useMain = !useOverride && main !== null && runnable(main.provider, main.credential);
  const fallback = deploymentModelRole("main", input.defaults).primary;
  const selected = useOverride
    ? {
        provider: bot!.modelProvider!,
        id: usableModelId(bot!.modelId),
        credential: overrideCredential,
      }
    : useMain
      ? { provider: main.provider, id: main.modelId, credential: main.credential }
      : { provider: fallback?.provider, id: fallback?.modelId ?? null, credential: null };
  const mainThinking =
    main &&
    selected.id &&
    backupChoiceKey(main) ===
      backupChoiceKey({ provider: selected.provider ?? "", modelId: selected.id })
      ? (main.thinkingLevel ?? null)
      : null;
  return {
    ...selected,
    thinkingLevel:
      hasOverride && !useOverride
        ? null
        : (((bot?.thinkingLevel ?? mainThinking) as AgentRunRequest["model"]["thinkingLevel"]) ??
          null),
  };
}
