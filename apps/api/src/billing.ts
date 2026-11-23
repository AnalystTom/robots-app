import { setTimeout as sleep } from "node:timers/promises";
import { ORPCError } from "@orpc/server";
import type {
  BillingByokPlan,
  BillingPrice,
  BillingProvider,
  BillingSubscriptionSnapshot,
  ProductAnalytics,
  SandboxProvider,
} from "@robots/adapter-kit";
import {
  BillingCheckoutCompletedError,
  BillingCustomerNotFoundError,
  BillingNoMonthlyCreditsError,
  BillingPaymentNotCompletedError,
} from "@robots/adapter-kit";
import { sandboxAllowance, sandboxHoursLeft } from "@robots/adapters";
import type {
  Actor,
  AnalyticsEvent,
  BillingStatus,
  ByokInterval,
  ByokTier,
} from "@robots/contracts";
import {
  BYOK_TIERS,
  ByokTierSchema,
  byokTierPriceCents,
  INVITED_TRIAL_WEEKS,
  sandboxAllowanceHours,
  TRIAL_DAYS,
} from "@robots/contracts";
import type { BillingAccount, Prisma, PrismaClient } from "@robots/db";
import {
  billingAccountForOrganization,
  byokFreeUntil,
  checkoutLeaseHeld,
  claimCheckoutLease,
  createBillingAccount,
  creditAccount,
  expireModelCredits,
  extendByokTrialCheckout,
  hasBillingAccess,
  hasModelAccess,
  isLockTimeout,
  lockCheckoutLease,
  MICROS_PER_DOLLAR,
  needsBillingPortal,
  organizationForMember,
  organizationOwnerHadTrial,
  organizationSeatCount,
  ownedBillingAccounts,
  reconcileCreditPurchase,
  releaseByokTrialCheckout,
  releaseByokTrialCheckouts,
  releaseCheckoutLease,
  renewCheckoutLease,
  replaceBillingCustomer,
  reserveByokTrialCheckout,
  syncBillingSnapshot,
  unexpiredCreditAccount,
} from "@robots/db";
import { getLogger } from "@robots/logging";
import { applyAccessGrants } from "./access-grants.js";
import { createExperiments } from "./experiments.js";
import { createReferrals } from "./referrals.js";

export { TRIAL_DAYS };

export const INVITED_TRIAL_DAYS = INVITED_TRIAL_WEEKS * 7;
const PRICE_CACHE_MS = 60 * 60 * 1000;
const CHECKOUT_LEASE_MS = 120_000;
const CHECKOUT_LEASE_POLL_MS = 250;

const CHECKOUT_LEASE_RENEW_MS = CHECKOUT_LEASE_MS / 4;

type UnderLease = <R>(write: (tx: Prisma.TransactionClient) => Promise<R>) => Promise<R>;

export const BILLING_RETURN_PATH = "/api/v1/billing/return";

export type BillingClient = "mobile" | undefined;

export interface BillingService {
  readonly modelCreditsEnabled: boolean;
  readonly referralsEnabled: boolean;
  status(actor: Actor): Promise<BillingStatus>;
  selectFunding(
    actor: Actor,
    funding: "byok" | "credits",
    client?: BillingClient,
    interval?: ByokInterval,
    tier?: ByokTier,
  ): Promise<{ ok: true; url?: string }>;
  purchaseCredits(
    actor: Actor,
    input: { amountCents: number; monthly: boolean; client?: BillingClient },
  ): Promise<{ url: string }>;
  setMonthlyCredits(actor: Actor, amountCents: number): Promise<{ ok: true }>;
  checkout(
    actor: Actor,
    client?: BillingClient,
    interval?: ByokInterval,
    tier?: ByokTier,
  ): Promise<{ url: string }>;
  portal(actor: Actor, client?: BillingClient): Promise<{ url: string }>;

  endTrial(actor: Actor): Promise<void>;
  switchToYearly(actor: Actor): Promise<void>;

  changeTier(actor: Actor, tier: ByokTier): Promise<void>;

  sync(customerId: string): Promise<void>;

  syncForActor(actor: Actor): Promise<void>;

  syncSeats(organizationId: string): Promise<void>;
  cancelForDeletedUser(userId: string): Promise<void>;
  cancelForDeletedOrganization(organizationId: string): Promise<void>;
  claimReferral(actor: Actor, code: string): Promise<void>;
}

function byokTrialAvailable(
  account: { subscribedAt: Date | null } | null,
  credits: { byokFreeUntil: Date | null },
  ownerHadOne: boolean,
) {
  return !ownerHadOne && !account?.subscribedAt && !credits.byokFreeUntil;
}

type PlanTerms = Omit<Extract<AnalyticsEvent, { name: "checkout_opened" }>, "name">;

function planTerms(live: BillingSubscriptionSnapshot): PlanTerms | null {
  if (live.creditAmountCents)
    return { plan: "credits", interval: "month", amountCents: live.creditAmountCents };
  if (live.byokPlan && live.byokPriceCents)
    return {
      plan: "own_key",
      tier: live.byokTier ?? "standard",
      interval: live.byokInterval ?? "month",
      amountCents: live.byokPriceCents,
    };
  return null;
}

function subscribedByokPrice(account: BillingAccount | null) {
  const status = account?.status ?? null;
  if (!account?.byokPriceCents || !(hasBillingAccess(status) || needsBillingPortal(status)))
    return null;
  const interval: ByokInterval = account.byokInterval === "year" ? "year" : "month";
  const tier = ByokTierSchema.catch("standard").parse(account.byokTier ?? "standard");
  return { cents: account.byokPriceCents, interval, tier };
}

function byokTierOffers() {
  return ByokTierSchema.options.flatMap((tier) => {
    const monthlyPriceCents = byokTierPriceCents(tier, "month");
    if (monthlyPriceCents === null) return [];
    const terms = BYOK_TIERS[tier];
    return [
      {
        tier,
        name: terms.name,
        monthlyPriceCents,
        annualPriceCents: byokTierPriceCents(tier, "year"),
        computerSize: terms.computerSize,
        computerHours: sandboxAllowanceHours(terms.computerAllowanceCents),
      },
    ];
  });
}

export function createBillingService(deps: {
  prisma: PrismaClient;
  provider: BillingProvider & { readonly billingUnit?: "workspace" };

  sandbox?: SandboxProvider;
  managedModelsAvailable?: boolean;

  webOrigin: string;
  analytics?: ProductAnalytics;
  experiments?: ReturnType<typeof createExperiments>;
}): BillingService {
  const { prisma, provider } = deps;
  const experiments = deps.experiments ?? createExperiments(undefined);
  const appUrl = `${deps.webOrigin}/app`;
  const returnUrl = `${deps.webOrigin}${BILLING_RETURN_PATH}`;

  const mobileReturnUrl = `${returnUrl}?client=mobile`;
  const modelCredits = provider.describe().capabilities.modelCredits === true;
  const perWorkspace = provider.billingUnit === "workspace";
  const supportsTrials = provider.describe().capabilities.trials;
  const billedUnits = (id: string) => (perWorkspace ? 1 : organizationSeatCount(prisma, id));
  const referrals = createReferrals(deps);
  let cachedPrice: { value: BillingPrice; expiresAt: number } | undefined;

  async function price(): Promise<BillingPrice | null> {
    if (cachedPrice && cachedPrice.expiresAt > Date.now()) return cachedPrice.value;
    try {
      const value = await provider.getPrice();
      cachedPrice = { value, expiresAt: Date.now() + PRICE_CACHE_MS };
      return value;
    } catch (error) {
      getLogger().error("billing price lookup failed", error);
      return null;
    }
  }

  async function organization(actor: Actor) {
    const found = await organizationForMember(prisma, {
      spaceId: actor.spaceId,
      userId: actor.userId,
    });
    if (!found) throw new ORPCError("FORBIDDEN");
    return found;
  }

  async function managedOrganization(actor: Actor) {
    const found = await organization(actor);
    if (!found.isOwner) throw new ORPCError("FORBIDDEN");
    if (await organizationBeingDeleted(found.organizationId))
      throw new ORPCError("CONFLICT", { message: "Organization is being deleted" });
    return found;
  }

  async function organizationBeingDeleted(organizationId: string) {
    const deleting = await prisma.space.findFirst({
      where: { organizationId, isDefault: true, deletingAt: { not: null } },
      select: { id: true },
    });
    return deleting !== null;
  }

  async function sync(customerId: string): Promise<void> {
    if (modelCredits && provider.listCreditPurchases) {
      const account = await prisma.billingAccount.findUnique({ where: { customerId } });
      if (account) {
        let added = false;
        for (const purchase of await provider.listCreditPurchases(customerId)) {
          if ((await reconcileCreditPurchase(prisma, account.organizationId, purchase)) > 0)
            added = true;
        }
        await prisma.modelCreditAccount.updateMany({
          where: {
            organizationId: account.organizationId,
            balanceMicros: { gt: 0n },
            OR: [{ mode: null }, ...(added ? [{ pendingCreditCheckout: true }] : [])],
          },
          data: { mode: "credits", pendingCreditCheckout: false },
        });
      }
    }
    const previous = await prisma.billingAccount.findUnique({ where: { customerId } });
    let snapshot = null as BillingSubscriptionSnapshot | null;
    const written = await syncBillingSnapshot(prisma, customerId, async () => {
      snapshot = await provider.getCustomerSubscription(customerId);
      return snapshot;
    });
    if (!written || !previous) {
      getLogger().warn("billing sync for unknown customer", { "billing.customer_id": customerId });
      return;
    }
    const live = snapshot;
    if (live)
      try {
        await reportCancellation(previous, live);
        await reportPlanChange(previous, live);
      } catch (error) {
        getLogger().warn("billing analytics failed", {
          "error.message": error instanceof Error ? error.message : String(error),
        });
      }
    if (live && hasBillingAccess(live.status))
      await referrals.settle(previous.organizationId, live.cardFingerprint);
    if (!modelCredits || !live) return;
    if (
      live.byokPlan &&
      hasBillingAccess(live.status) &&
      live.subscriptionId !== previous.subscriptionId
    )
      await prisma.modelCreditAccount.updateMany({
        where: {
          organizationId: previous.organizationId,
          organization: { billing: { subscriptionId: live.subscriptionId } },
        },
        data: { mode: "byok", pendingCreditCheckout: false },
      });
    if (
      provider.endByokPlans &&
      hasBillingAccess(live.status) &&
      (live.creditAmountCents ||
        (BYOK_TIERS.standard.monthlyPriceCents === null &&
          live.byokPlan &&
          !live.cancelAtPeriodEnd))
    )
      await provider.endByokPlans(customerId);
  }

  async function reportCancellation(previous: BillingAccount, live: BillingSubscriptionSnapshot) {
    const { analytics } = deps;
    if (
      !analytics ||
      !(live.cancellationReason || live.cancellationComment) ||
      (live.cancellationReason === (previous.cancellationReason ?? undefined) &&
        live.cancellationComment === (previous.cancellationComment ?? undefined))
    )
      return;
    const owner = await ownerUserId(previous.organizationId);
    if (!owner) return;
    analytics.capture(owner, {
      name: "subscription_cancel_feedback",
      ...(live.cancellationReason ? { reason: live.cancellationReason } : {}),
      commented: Boolean(live.cancellationComment),
    });
  }

  async function reportPlanChange(previous: BillingAccount, live: BillingSubscriptionSnapshot) {
    const { analytics } = deps;
    const same = live.subscriptionId === previous.subscriptionId;
    const started = hasBillingAccess(live.status) && (!same || previous.status === "incomplete");
    const trialEnded = same && previous.status === "trialing" && live.status !== "trialing";
    const terms = planTerms(live);
    if (!analytics || !terms || !(started || trialEnded)) return;
    const owner = await ownerUserId(previous.organizationId);
    if (!owner) return;
    const at = (started ? live.currentPeriodStartsAt : live.trialEndsAt) ?? new Date();
    analytics.capture(
      owner,
      started
        ? { name: "subscription_started", ...terms, trial: live.status === "trialing" }
        : { name: "trial_ended", ...terms, converted: live.status === "active" },
      { id: live.subscriptionId, at },
      experiments.tags("plan-layout", previous.organizationId),
    );
  }

  async function ownerUserId(organizationId: string) {
    const owner = await prisma.member.findFirst({
      where: { organizationId, role: { contains: "owner" } },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    return owner?.userId;
  }

  async function cancel(account: BillingAccount) {
    await withCheckoutLease(account.organizationId, async () => {
      await provider.cancelCustomerSubscriptions(account.customerId);
      await sync(account.customerId);
    });
  }

  async function newCustomer(actor: Actor, organizationId: string) {
    return (await provider.createCustomer({ email: actor.email, organizationId })).customerId;
  }

  async function withLiveCustomer<T>(
    actor: Actor,
    account: BillingAccount,
    call: (customerId: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(account.customerId);
    } catch (error) {
      if (!(error instanceof BillingCustomerNotFoundError)) throw error;
      const replaced = await replaceBillingCustomer(prisma, {
        organizationId: account.organizationId,
        previousCustomerId: account.customerId,
        customerId: await newCustomer(actor, account.organizationId),
      });
      return call(replaced.customerId);
    }
  }

  async function openCheckout(
    actor: Actor,
    account: BillingAccount,
    call: (customerId: string, underLease: UnderLease) => Promise<{ url: string }>,
  ) {
    return withCheckoutLease(account.organizationId, async (underLease) => {
      if (await organizationBeingDeleted(account.organizationId))
        throw new ORPCError("CONFLICT", { message: "Organization is being deleted" });
      return withLiveCustomer(actor, account, (customerId) => call(customerId, underLease));
    });
  }

  async function withCheckoutLease<T>(
    organizationId: string,
    work: (underLease: UnderLease) => Promise<T>,
  ) {
    const deadline = Date.now() + CHECKOUT_LEASE_MS;
    let leaseId = await claimCheckoutLease(prisma, organizationId, CHECKOUT_LEASE_MS);
    while (!leaseId) {
      if (Date.now() > deadline) throw new ORPCError("CONFLICT");
      await sleep(CHECKOUT_LEASE_POLL_MS);
      leaseId = await claimCheckoutLease(prisma, organizationId, CHECKOUT_LEASE_MS);
    }
    const renew = setInterval(
      () =>
        void renewCheckoutLease(prisma, organizationId, leaseId, CHECKOUT_LEASE_MS).catch(() => {}),
      CHECKOUT_LEASE_RENEW_MS,
    );
    renew.unref();
    const busy = () => new ORPCError("CONFLICT", { message: "Billing is busy; try again shortly" });
    const underLease: UnderLease = (write) =>
      prisma
        .$transaction(async (tx) => {
          if (!(await lockCheckoutLease(tx, organizationId, leaseId))) throw busy();
          return write(tx);
        })
        .catch((error: unknown) => {
          if (isLockTimeout(error)) throw busy();
          throw error;
        });
    try {
      const result = await work(underLease);
      if (!(await checkoutLeaseHeld(prisma, organizationId, leaseId)))
        throw new ORPCError("CONFLICT", { message: "Billing is busy; try again shortly" });
      return result;
    } finally {
      clearInterval(renew);
      await releaseCheckoutLease(prisma, organizationId, leaseId);
    }
  }

  async function trialDays(organizationId: string) {
    return (await referrals.invited(organizationId)) ? INVITED_TRIAL_DAYS : TRIAL_DAYS;
  }

  async function billingAccountFor(actor: Actor, organizationId: string) {
    return (
      (await billingAccountForOrganization(prisma, organizationId)) ??
      createBillingAccount(prisma, {
        organizationId,
        customerId: await newCustomer(actor, organizationId),
      })
    );
  }

  async function byokCheckout(
    actor: Actor,
    organizationId: string,
    client: BillingClient,
    interval: ByokInterval = "month",
    tier: ByokTier = "standard",
  ) {
    const amountCents = byokTierPriceCents(tier, interval);
    if (amountCents === null || !provider.createByokCheckout) throw new ORPCError("NOT_FOUND");
    const [account, credits, days, hadTrial] = await Promise.all([
      billingAccountFor(actor, organizationId),
      creditAccount(prisma, organizationId),
      trialDays(organizationId),
      organizationOwnerHadTrial(prisma, organizationId, "byok"),
    ]);
    try {
      const session = await openCheckout(actor, account, async (customerId, underLease) => {
        await provider.expireOpenCheckouts(customerId);
        await sync(customerId);
        const hold = await underLease(async (tx) => {
          await releaseByokTrialCheckouts(tx, organizationId);
          return byokTrialAvailable(account, credits, hadTrial)
            ? reserveByokTrialCheckout(tx, organizationId)
            : null;
        });
        let session: { url: string };
        try {
          session = await provider.createByokCheckout!({
            customerId,
            amountCents,
            interval,
            tier,
            ...(hold ? { trialDays: days } : {}),
            successUrl: client === "mobile" ? mobileReturnUrl : returnUrl,
            cancelUrl: client === "mobile" ? mobileReturnUrl : appUrl,
          });
        } catch (error) {
          if (hold && !(error instanceof BillingCheckoutCompletedError))
            await releaseByokTrialCheckout(prisma, organizationId, hold);
          throw error;
        }
        if (hold) await extendByokTrialCheckout(prisma, organizationId, hold);
        return session;
      });
      deps.analytics?.capture(
        actor.userId,
        { name: "checkout_opened", plan: "own_key", tier, interval, amountCents },
        undefined,
        experiments.tags("plan-layout", organizationId),
      );
      return session;
    } catch (error) {
      if (!(error instanceof BillingCheckoutCompletedError)) throw error;
      await sync(account.customerId);
      throw new ORPCError("CONFLICT", { message: "Manage your existing subscription in Billing" });
    }
  }

  async function changeByokPlan(
    actor: Actor,
    target: (from: BillingByokPlan) => BillingByokPlan | null,
  ) {
    if (!provider.changeByokPlan) throw new ORPCError("NOT_FOUND");
    const { organizationId } = await managedOrganization(actor);
    const stored = await billingAccountForOrganization(prisma, organizationId);
    if (!stored) throw new ORPCError("NOT_FOUND", { message: "No billing account" });
    await withCheckoutLease(organizationId, async () => {
      await sync(stored.customerId);
      const account = await billingAccountForOrganization(prisma, organizationId);
      const conflict = () => new ORPCError("CONFLICT", { message: "No own-key plan to change" });
      const subscribed = subscribedByokPrice(account);
      if (
        !account?.subscriptionId ||
        !subscribed ||
        account.creditAmountCents ||
        account.cancelAtPeriodEnd ||
        (account.status !== "active" && account.status !== "trialing")
      )
        throw conflict();
      const from = {
        tier: subscribed.tier,
        interval: subscribed.interval,
        amountCents: subscribed.cents,
      };
      const to = target(from);
      if (!to) throw conflict();
      const allowanceCents = BYOK_TIERS[to.tier].computerAllowanceCents;
      if (allowanceCents < BYOK_TIERS[from.tier].computerAllowanceCents && deps.sandbox) {
        const allowance = await sandboxAllowance({ prisma, sandbox: deps.sandbox }, organizationId);
        if (allowance && allowance.usedMicros > (allowanceCents * MICROS_PER_DOLLAR) / 100)
          throw new ORPCError("CONFLICT", {
            message: "This month's computer use is more than the smaller plan includes",
          });
      }
      const changed = await provider.changeByokPlan!(account.customerId, account.subscriptionId, {
        from,
        to,
      });
      await sync(account.customerId);
      if (!changed) throw conflict();
    });
  }

  return {
    modelCreditsEnabled: modelCredits,
    referralsEnabled: referrals.enabled,
    async selectFunding(actor, funding, client, interval, tier) {
      const { organizationId } = await managedOrganization(actor);
      if (funding === "credits") await expireModelCredits(prisma, organizationId);
      const account = await creditAccount(prisma, organizationId);
      const subscription = await billingAccountForOrganization(prisma, organizationId);
      if (
        funding === "byok" &&
        subscription?.creditAmountCents &&
        !subscription.cancelAtPeriodEnd &&
        !["canceled", "incomplete_expired"].includes(subscription.status ?? "")
      )
        throw new ORPCError("CONFLICT", {
          message: "Cancel monthly credits in Billing before switching to your API key.",
        });
      if (
        funding === "byok" &&
        !hasModelAccess({ ...account, mode: "byok" }, subscription?.status ?? null)
      )
        return { ok: true, ...(await byokCheckout(actor, organizationId, client, interval, tier)) };
      await prisma.modelCreditAccount.update({
        where: { organizationId },
        data: {
          mode: funding === "byok" ? "byok" : account.balanceMicros > 0n ? "credits" : null,
          pendingCreditCheckout: false,
        },
      });
      return { ok: true };
    },

    async purchaseCredits(actor, { client, ...input }) {
      if (!modelCredits || !provider.createCreditCheckout) throw new ORPCError("NOT_FOUND");
      if (deps.managedModelsAvailable === false) throw new ORPCError("PRECONDITION_FAILED");
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountFor(actor, organizationId);
      await creditAccount(prisma, organizationId);
      try {
        const checkout = await openCheckout(actor, account, (customerId) =>
          provider.createCreditCheckout!({
            customerId,
            ...input,
            successUrl: client === "mobile" ? mobileReturnUrl : returnUrl,
            cancelUrl: client === "mobile" ? mobileReturnUrl : `${appUrl}?billing=canceled`,
          }),
        );
        await prisma.modelCreditAccount.update({
          where: { organizationId },
          data: { pendingCreditCheckout: true },
        });
        if (input.monthly)
          deps.analytics?.capture(
            actor.userId,
            {
              name: "checkout_opened",
              plan: "credits",
              interval: "month",
              amountCents: input.amountCents,
            },
            undefined,
            experiments.tags("plan-layout", organizationId),
          );
        return checkout;
      } catch (error) {
        if (error instanceof BillingCheckoutCompletedError)
          throw new ORPCError("CONFLICT", {
            message: "Manage your existing subscription in Billing",
          });
        throw error;
      }
    },

    async setMonthlyCredits(actor, amountCents) {
      if (!modelCredits || !provider.setMonthlyCredits) throw new ORPCError("NOT_FOUND");
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) throw new ORPCError("NOT_FOUND");
      try {
        await provider.setMonthlyCredits(account.customerId, amountCents);
      } catch (error) {
        if (error instanceof BillingPaymentNotCompletedError)
          throw new ORPCError("PAYMENT_REQUIRED", { status: 402, message: error.message });
        if (!(error instanceof BillingNoMonthlyCreditsError)) throw error;
        await sync(account.customerId);
        throw new ORPCError("CONFLICT", { message: error.message, cause: error });
      }
      await sync(account.customerId);
      return { ok: true };
    },

    async status(actor) {
      if (modelCredits) {
        const { organizationId, isOwner } = await organization(actor);
        if (isOwner)
          await applyAccessGrants(prisma, { ...actor, organizationId }).catch((error) =>
            getLogger().error("access grant failed", error),
          );
        const [credits, account, computerAllowance, days, hadTrial] = await Promise.all([
          unexpiredCreditAccount(prisma, organizationId),
          billingAccountForOrganization(prisma, organizationId),
          deps.sandbox ? sandboxAllowance({ prisma, sandbox: deps.sandbox }, organizationId) : null,
          trialDays(organizationId),
          organizationOwnerHadTrial(prisma, organizationId, "byok"),
        ]);
        const freeUntil =
          credits.mode === "byok" &&
          BYOK_TIERS.standard.monthlyPriceCents !== null &&
          !hasBillingAccess(account?.status ?? null)
            ? byokFreeUntil(credits)
            : null;
        const subscribed = subscribedByokPrice(account);
        const tier = subscribed?.tier ?? "standard";
        const offers = byokTierOffers();
        return {
          access: hasModelAccess(credits, account?.status ?? null),
          funding:
            credits.mode === "byok"
              ? "byok"
              : credits.balanceMicros > 0n || credits.mode === "credits"
                ? "credits"
                : null,
          balanceUsd: Number(credits.balanceMicros) / MICROS_PER_DOLLAR,
          monthlyAmountCents: account?.creditAmountCents ?? null,
          creditPurchasesEnabled: deps.managedModelsAvailable ?? true,
          byokPriceCents:
            BYOK_TIERS.standard.monthlyPriceCents &&
            (subscribed?.cents ?? BYOK_TIERS.standard.monthlyPriceCents),
          byokInterval: subscribed?.interval ?? "month",
          byokAnnualPriceCents: byokTierPriceCents(tier, "year"),
          byokTier: tier,
          ...(offers.length ? { byokTiers: offers } : {}),
          ...(offers.length > 1 && !account?.subscribedAt && experiments.running("plan-layout")
            ? { planLayout: experiments.variant("plan-layout", organizationId) }
            : {}),
          byokFreeUntil: freeUntil?.toISOString() ?? null,
          canManage: isOwner,
          trialAvailable:
            BYOK_TIERS.standard.monthlyPriceCents !== null &&
            byokTrialAvailable(account, credits, hadTrial),
          trialDays: days,
          state: (account?.status ?? "none") as BillingStatus["state"],
          price: account?.creditAmountCents
            ? {
                amount: account.creditAmountCents,
                currency: "usd",
                interval: "month" as const,
                intervalCount: 1,
              }
            : null,
          seats: 1,
          trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
          currentPeriodEndsAt: account?.currentPeriodEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
          hasCustomer: Boolean(account),
          computerHoursLeft: computerAllowance && sandboxHoursLeft(computerAllowance),
          computerHoursResetAt: computerAllowance?.resetsAt?.toISOString() ?? null,
          referral: await referrals.status(organizationId, isOwner),
        };
      }
      const { organizationId, isOwner } = await organization(actor);
      const [account, currentPrice, days, hadTrial] = await Promise.all([
        billingAccountForOrganization(prisma, organizationId),
        price(),
        trialDays(organizationId),
        organizationOwnerHadTrial(prisma, organizationId, "managed"),
      ]);
      const status = account?.status ?? null;
      return {
        access: hasBillingAccess(status),
        canManage: isOwner,
        trialAvailable: supportsTrials && !account?.subscribedAt && !hadTrial,
        trialDays: days,
        state: (status ?? "none") as BillingStatus["state"],
        price: currentPrice,
        seats: account?.seats ?? (await billedUnits(organizationId)),
        trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: account?.currentPeriodEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
        hasCustomer: Boolean(account),
      };
    },

    async checkout(actor, client, interval, tier) {
      const { organizationId } = await managedOrganization(actor);
      if (modelCredits) return byokCheckout(actor, organizationId, client, interval, tier);
      let account = await billingAccountForOrganization(prisma, organizationId);
      if (account) {
        await sync(account.customerId);
        account = await billingAccountForOrganization(prisma, organizationId);
      }
      if (hasBillingAccess(account?.status ?? null)) {
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      }
      if (needsBillingPortal(account?.status ?? null)) {
        throw new ORPCError("CONFLICT", { message: "Resume the subscription in billing" });
      }
      account ??= await createBillingAccount(prisma, {
        organizationId,
        customerId: await newCustomer(actor, organizationId),
      });
      const seats = await billedUnits(organizationId);
      const trial =
        !supportsTrials ||
        account.subscribedAt ||
        (await organizationOwnerHadTrial(prisma, organizationId, "managed"))
          ? {}
          : { trialDays: await trialDays(organizationId) };
      try {
        return await openCheckout(actor, account, (customerId) =>
          provider.createCheckout({
            customerId,
            seats,
            ...trial,
            successUrl: client === "mobile" ? mobileReturnUrl : returnUrl,
            cancelUrl: client === "mobile" ? mobileReturnUrl : appUrl,
          }),
        );
      } catch (error) {
        if (!(error instanceof BillingCheckoutCompletedError)) throw error;
        await sync(account.customerId);
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      }
    },

    async portal(actor, client) {
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) throw new ORPCError("NOT_FOUND", { message: "No billing account" });
      return withLiveCustomer(actor, account, (customerId) =>
        provider.createPortal({
          customerId,
          returnUrl: client === "mobile" ? mobileReturnUrl : appUrl,
        }),
      );
    },

    async endTrial(actor) {
      if (!provider.endTrial) throw new ORPCError("NOT_FOUND");
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) throw new ORPCError("NOT_FOUND", { message: "No billing account" });
      try {
        await provider.endTrial(account.customerId);
      } catch (error) {
        if (!(error instanceof BillingPaymentNotCompletedError)) throw error;
        throw new ORPCError("PAYMENT_REQUIRED", { status: 402, message: error.message });
      }
      await sync(account.customerId);
    },

    async switchToYearly(actor) {
      await changeByokPlan(actor, (from) => {
        const amountCents = byokTierPriceCents(from.tier, "year");
        return from.interval === "month" &&
          amountCents !== null &&
          from.amountCents * 12 > amountCents
          ? { tier: from.tier, interval: "year", amountCents }
          : null;
      });
    },

    async changeTier(actor, tier) {
      await changeByokPlan(actor, (from) => {
        const amountCents = byokTierPriceCents(tier, from.interval);
        return tier !== from.tier && amountCents !== null
          ? { tier, interval: from.interval, amountCents }
          : null;
      });
    },

    sync,

    async syncForActor(actor) {
      const { organizationId } = await organization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (account) await sync(account.customerId);
    },

    async syncSeats(organizationId) {
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account || account.creditAmountCents) return;
      const seats = await billedUnits(organizationId);
      if (account.seats === seats) return;
      await provider.updateSeats(account.customerId, seats);
      await sync(account.customerId);
    },

    async claimReferral(actor, code) {
      const { organizationId, isOwner } = await organization(actor);
      if (isOwner) await referrals.claim(organizationId, code, actor.userId);
    },

    async cancelForDeletedUser(userId) {
      for (const account of await ownedBillingAccounts(prisma, userId)) await cancel(account);
    },

    async cancelForDeletedOrganization(organizationId) {
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) return;
      await cancel(account);
      await releaseByokTrialCheckouts(prisma, organizationId);
    },
  };
}
