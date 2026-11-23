import type { ActionRule, SettingsScope } from "@robots/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { lockSpaceSettings, settingsTarget } from "./space-settings.js";

type Scope = { userId: string; spaceId: string };
type ConfirmationsTx = ConfirmationsClient & Pick<Prisma.TransactionClient, "$queryRaw">;
type ConfirmationsClient = Pick<
  PrismaClient,
  | "spaceSettingOverride"
  | "actionApprovalRule"
  | "userActionApprovalRule"
  | "actionAutoReviewPreference"
  | "userActionAutoReviewPreference"
>;

export function storedBatchActions(
  value: Prisma.JsonValue | null | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((action): action is string => typeof action === "string");
}

export type ApprovalRuleInput = { effect: string; matchKind: string; matchValue: string };
export type AutoReviewPreference = { enabled: boolean; skipApprovals: boolean };

function confirmationsTarget(prisma: ConfirmationsClient, scope: Scope, requested?: SettingsScope) {
  return settingsTarget(prisma, scope, "confirmations", requested);
}

export async function listApprovalRules(
  prisma: ConfirmationsClient,
  scope: Scope,
  requested?: SettingsScope,
) {
  const orderBy = { createdAt: "asc" } as const;
  return (await confirmationsTarget(prisma, scope, requested)) === "account"
    ? prisma.userActionApprovalRule.findMany({ where: { userId: scope.userId }, orderBy })
    : prisma.actionApprovalRule.findMany({
        where: { spaceId: scope.spaceId, createdByUserId: scope.userId },
        orderBy,
      });
}

export async function saveApprovalRule(
  tx: ConfirmationsTx,
  scope: Scope,
  rule: ApprovalRuleInput,
  requested?: SettingsScope,
) {
  await lockSpaceSettings(tx, scope);
  const account = (await confirmationsTarget(tx, scope, requested)) === "account";
  const owner = account ? `account:${scope.userId}` : `${scope.spaceId}:${scope.userId}`;
  const value = rule.matchValue.toLowerCase();
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`approval-rule:${owner}:${rule.matchKind}:${value}`}, 0))::text AS "lock"
  `);
  const replaced = (rows: Array<{ id: string; effect: string; matchValue: string }>) =>
    rows
      .filter((row) => row.matchValue.toLowerCase() === value)
      .filter((row) => row.effect !== rule.effect || row.matchValue !== rule.matchValue)
      .map((row) => row.id);
  const select = { id: true, effect: true, matchValue: true } as const;
  if (account) {
    const where = { userId: scope.userId, matchKind: rule.matchKind };
    const ids = replaced(await tx.userActionApprovalRule.findMany({ where, select }));
    await tx.userActionApprovalRule.deleteMany({ where: { id: { in: ids } } });
    const row = { userId: scope.userId, ...rule };
    return tx.userActionApprovalRule.upsert({
      where: { userId_effect_matchKind_matchValue: row },
      create: row,
      update: {},
    });
  }
  const where = {
    spaceId: scope.spaceId,
    createdByUserId: scope.userId,
    matchKind: rule.matchKind,
  };
  const ids = replaced(await tx.actionApprovalRule.findMany({ where, select }));
  await tx.actionApprovalRule.deleteMany({ where: { id: { in: ids } } });
  const row = { spaceId: scope.spaceId, createdByUserId: scope.userId, ...rule };
  return tx.actionApprovalRule.upsert({
    where: { spaceId_createdByUserId_effect_matchKind_matchValue: row },
    create: row,
    update: {},
  });
}

export async function removeApprovalRule(
  prisma: ConfirmationsTx,
  scope: Scope,
  id: string,
  requested?: SettingsScope,
) {
  await lockSpaceSettings(prisma, scope);
  if ((await confirmationsTarget(prisma, scope, requested)) === "account") {
    await prisma.userActionApprovalRule.deleteMany({ where: { id, userId: scope.userId } });
  } else {
    await prisma.actionApprovalRule.deleteMany({
      where: { id, spaceId: scope.spaceId, createdByUserId: scope.userId },
    });
  }
}

export async function findAutoReviewPreference(
  prisma: ConfirmationsClient,
  scope: Scope,
  requested?: SettingsScope,
): Promise<AutoReviewPreference | null> {
  const select = { enabled: true, skipApprovals: true } as const;
  return (await confirmationsTarget(prisma, scope, requested)) === "account"
    ? prisma.userActionAutoReviewPreference.findUnique({
        where: { userId: scope.userId },
        select,
      })
    : prisma.actionAutoReviewPreference.findUnique({
        where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
        select,
      });
}

export async function saveAutoReviewPreference(
  prisma: ConfirmationsTx,
  scope: Scope,
  update: Partial<AutoReviewPreference>,
  defaults: AutoReviewPreference,
  requested?: SettingsScope,
) {
  const create = {
    enabled: update.enabled ?? defaults.enabled,
    skipApprovals: update.skipApprovals ?? defaults.skipApprovals,
  };
  await lockSpaceSettings(prisma, scope);
  if ((await confirmationsTarget(prisma, scope, requested)) === "account") {
    await prisma.userActionAutoReviewPreference.upsert({
      where: { userId: scope.userId },
      create: { userId: scope.userId, ...create },
      update,
    });
  } else {
    await prisma.actionAutoReviewPreference.upsert({
      where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
      create: { spaceId: scope.spaceId, userId: scope.userId, ...create },
      update,
    });
  }
}

export async function listActionRules(
  prisma: ConfirmationsClient,
  scope: Scope,
  requested?: SettingsScope,
): Promise<unknown[]> {
  const select = { actionRules: true } as const;
  const row =
    (await confirmationsTarget(prisma, scope, requested)) === "account"
      ? await prisma.userActionAutoReviewPreference.findUnique({
          where: { userId: scope.userId },
          select,
        })
      : await prisma.actionAutoReviewPreference.findUnique({
          where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
          select,
        });
  const stored = row?.actionRules;
  if (stored == null) return [];
  return Array.isArray(stored) ? stored : [stored];
}

export async function saveActionRules(
  prisma: ConfirmationsTx,
  scope: Scope,
  rules: readonly ActionRule[],
  requested?: SettingsScope,
): Promise<void> {
  const actionRules = rules as unknown as Prisma.InputJsonValue;
  const create = { enabled: true, skipApprovals: false, actionRules };
  await lockSpaceSettings(prisma, scope);
  if ((await confirmationsTarget(prisma, scope, requested)) === "account") {
    await prisma.userActionAutoReviewPreference.upsert({
      where: { userId: scope.userId },
      create: { userId: scope.userId, ...create },
      update: { actionRules },
    });
  } else {
    await prisma.actionAutoReviewPreference.upsert({
      where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
      create: { spaceId: scope.spaceId, userId: scope.userId, ...create },
      update: { actionRules },
    });
  }
}
