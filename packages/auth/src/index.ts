import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import type { ProductAnalytics, TransactionalEmailProvider } from "@robots/adapter-kit";
import { LAST_SIGN_IN_COOKIE, SignupAttribution } from "@robots/contracts";
import {
  displayName,
  emailAllowed,
  isMessagingEmail,
  MAX_PASSWORD_LENGTH,
  MESSAGING_EMAIL_SUFFIX,
  MIN_PASSWORD_LENGTH,
  signupAttributionFromHeaders,
  signupPolicyFromEnv,
} from "@robots/core";
import type { PrismaClient, SecurityEventType } from "@robots/db";
import {
  bootstrapUserSpace,
  personalOrganizationIds,
  recordSecurityEvent,
  SpaceDeletionInProgressError,
} from "@robots/db";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth, getAuthStateVerificationIdentifier } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";
import { parseSetCookieHeader } from "better-auth/cookies";
import { emailOTP, lastLoginMethod, organization } from "better-auth/plugins";
import {
  ACCOUNT_EXPORT_TOKEN_PREFIX,
  consumeAccountExportToken,
  issueAccountExportToken,
} from "./account-export-token.js";
import {
  accountSecurity,
  oidcProofKey,
  sessionForAuthHook,
  signedBearer,
} from "./account-security.js";
import { createAppleClientSecretCache } from "./apple-client-secret.js";
import { breachedPasswordCheck } from "./breached-password.js";
import { devicePairing, issuePairingCode, PAIRING_CODE_PREFIX } from "./device-pairing.js";
import { DEACTIVATED_AT_FIELD } from "./directory.js";
import type { EmailLocaleOf } from "./email.js";
import { emailLocale, passwordResetEmail, signInCodeEmail, verificationEmail } from "./email.js";
import { hasRecentIdentityConfirmation, identityConfirmation } from "./identity-confirmation.js";
import type { OidcConfig } from "./oidc.js";
import { isCurrentOidcAccount, oidcDiscovery } from "./oidc.js";
import { passkeyRelyingParty } from "./passkey.js";
import type { AppleProviderConfig, GoogleProviderConfig, SocialAuthConfig } from "./social.js";
import {
  appleUserInfo,
  googleEmailVerified,
  isDefaultAuthorizationRequest,
  requestProviderId,
  socialTrustedOrigins,
} from "./social.js";
import { socialCallbackProtection } from "./social-callback-protection.js";
import type { TokenKey } from "./token-storage.js";
import { encryptStoredOAuthTokens, openIdToken, sealIdToken } from "./token-storage.js";

export type { DirectoryAccountChange } from "./directory.js";
export { createDirectory } from "./directory.js";
export {
  emailLocale,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "./email.js";
export type { HomeDeletionReason } from "./home-deletion-email.js";
export { homeDeletionEmail } from "./home-deletion-email.js";
export type { OidcConfig } from "./oidc.js";
export { passkeyRelyingParty } from "./passkey.js";
export {
  integrationClaimConfirmEmail,
  pluginSubmissionAdminEmail,
  pluginSubmissionReceivedEmail,
  pluginSubmissionReviewedEmail,
} from "./plugin-submission-email.js";
export { referralEmail } from "./referral-email.js";
export type { SocialAuthConfig } from "./social.js";
export { publicSignInProviders, socialAuthFromFields } from "./social.js";
export { welcomeEmail } from "./welcome-email.js";

export interface AuthEnv {
  analytics?: ProductAnalytics;
  passwordAuth?: boolean;
  emailSignup?: boolean;
  breachedPasswordCheck?: boolean;
  oidc?: OidcConfig;
  social?: SocialAuthConfig;
  secret: string;
  baseURL: string;
  webOrigin: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  singleAccount?: boolean;
  extraOrigins?: string[];
  androidAppCertFingerprints?: string[];
  email?: TransactionalEmailProvider;
  logger?: BetterAuthOptions["logger"];
  onEmailError?: (error: unknown) => void;
  beforeDeleteUser?: (userId: string) => Promise<void>;
  afterDeleteSession?: (session: AuthSession) => Promise<void>;
  afterReplaceSession?: (previous: AuthSession, session: AuthSession) => Promise<void>;
  afterSignIn?: (userId: string, headers?: Headers) => Promise<void>;
  directoryProvisioning?: boolean;
  afterDevicePaired?: (userId: string) => Promise<void>;
}

type AuthSession = { id: string; userId: string };

const SEND_SIGN_IN_CODE_PATH = "/email-otp/send-verification-otp";
const CODE_SIGN_IN_PATH = "/sign-in/email-otp";

const CREDENTIAL_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  SEND_SIGN_IN_CODE_PATH,
  CODE_SIGN_IN_PATH,
] as const;

export const SIGN_IN_CODE_EXPIRES_IN_SECONDS = 10 * 60;

function isUnusedEmailCodePath(path: string, body: { type?: unknown } | undefined): boolean {
  if (path === SEND_SIGN_IN_CODE_PATH) return body?.type !== "sign-in";
  return path.startsWith("/email-otp/") || path === "/forget-password/email-otp";
}

export const CLIENT_IP_HEADER = "x-robots-client-ip";

const REVOCATION_PATHS = new Set(["/revoke-session", "/revoke-sessions", "/revoke-other-sessions"]);

const ACCOUNT_EVENT_PATHS: Record<string, SecurityEventType> = {
  "/change-password": "auth.password.changed",
  "/set-password": "auth.password.changed",
  "/passkey/verify-registration": "auth.passkey.added",
  "/passkey/update-passkey": "auth.passkey.changed",
  "/passkey/delete-passkey": "auth.passkey.removed",
};

export function authRateLimitOptions(nodeEnv = process.env.NODE_ENV) {
  const rule = { window: 15 * 60, max: 10 };
  return {
    enabled: nodeEnv === "production",
    storage: "database" as const,
    customRules: {
      ...Object.fromEntries(CREDENTIAL_PATHS.map((path) => [path, rule])),
      "/request-account-deletion": { window: 600, max: 3 },
      "/request-identity-code": { window: 600, max: 3 },
      "/confirm-identity": rule,
      "/pairing/exchange": rule,
      "/passkey/verify-authentication": rule,
      "/passkey/verify-registration": rule,
      "/passkey/generate-authenticate-options": { window: 60, max: 30 },
    },
  };
}

export function createAuth(prisma: PrismaClient, env: AuthEnv) {
  if (env.passwordAuth === false && !env.oidc)
    throw new Error("Password auth requires OIDC when disabled");
  const emailLocaleOf: EmailLocaleOf = async (account, headers) => {
    try {
      const saved = await prisma.user.findUnique({ where: account, select: { locale: true } });
      return emailLocale(saved?.locale, headers);
    } catch {
      return emailLocale(null, headers);
    }
  };
  const discovery = env.oidc ? oidcDiscovery(env.oidc) : undefined;
  const hasAdmittedAccount = async (
    client: Pick<PrismaClient, "user" | "spaceMember">,
    exceptUserId?: string,
  ) => {
    const others = await client.user.findMany({
      where: {
        ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
        NOT: { email: { endsWith: MESSAGING_EMAIL_SUFFIX } },
      },
      select: { id: true },
    });
    return (
      others.length > 0 &&
      Boolean(
        await client.spaceMember.findFirst({
          where: { userId: { in: others.map((other) => other.id) } },
          select: { userId: true },
        }),
      )
    );
  };
  const admission = async () => {
    const policy = signupPolicyFromEnv(env);
    if (!env.singleAccount || !policy.enabled) return policy;
    return (await hasAdmittedAccount(prisma)) ? { ...policy, enabled: false } : policy;
  };
  const emailAdmission = async () =>
    env.emailSignup === false ? { ...signupPolicyFromEnv(env), enabled: false } : admission();
  const admitSoleAccount = (userId: string) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('robots:single-account'))`;
      if (await hasAdmittedAccount(tx, userId)) return false;
      await bootstrapUserSpace(prisma, { id: userId }, env);
      return true;
    });
  const provisioned = async (userId: string) =>
    Boolean(env.directoryProvisioning) &&
    Boolean(
      await prisma.scimUser.findFirst({ where: { userId, active: true }, select: { id: true } }),
    );
  const claimable = async (userId: string) => {
    if (!env.directoryProvisioning) return false;
    const [subject, membership, user] = await Promise.all([
      prisma.scimSubject.findUnique({ where: { userId }, select: { profileSourceId: true } }),
      prisma.spaceMember.findFirst({ where: { userId }, select: { userId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { deactivatedAt: true } }),
    ]);
    return Boolean(subject?.profileSourceId) && !membership && !user?.deactivatedAt;
  };
  const emailCodeSignIn = Boolean(env.email) && env.passwordAuth !== false;
  const relyingParty =
    env.passwordAuth === false
      ? null
      : passkeyRelyingParty(env.webOrigin, env.androidAppCertFingerprints);
  const google = env.social?.providers.find(
    (provider): provider is GoogleProviderConfig => provider.id === "google",
  );
  const apple = env.social?.providers.find(
    (provider): provider is AppleProviderConfig => provider.id === "apple",
  );
  const appleSecret = apple ? createAppleClientSecretCache(apple) : undefined;
  let authContext: Promise<{ secretConfig: TokenKey }> | undefined;
  const tokenKey = async () => (await authContext!).secretConfig;
  const attributionField = {
    type: "string",
    required: false,
    input: false,
    returned: false,
  } as const;
  const auth = betterAuth({
    appName: "RoBots",
    logger: env.logger,
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: (request) => [
      ...buildTrustedOrigins({
        origins: [env.webOrigin, env.baseURL],
        extraOrigins: env.extraOrigins,
      }),
      APP_SCHEME_ORIGIN,
      ...socialTrustedOrigins(env.social, request),
    ],
    account: {
      accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: [] },
      encryptOAuthTokens: true,
    },
    verification: {
      storeIdentifier: {
        default: "plain",
        overrides: {
          "reset-password:": "hashed",
          "delete-account-": "hashed",
          [ACCOUNT_EXPORT_TOKEN_PREFIX]: "hashed",
          [PAIRING_CODE_PREFIX]: "hashed",
        },
      },
    },
    rateLimit: authRateLimitOptions(),
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    socialProviders: {
      ...(google
        ? {
            google: {
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              mapProfileToUser: async (profile) => ({
                emailVerified:
                  googleEmailVerified(profile) ||
                  (profile.email_verified === true && Boolean((await getOAuthState())?.link)),
              }),
            },
          }
        : {}),
      ...(apple && appleSecret
        ? {
            apple: {
              clientId: apple.clientId,
              get clientSecret() {
                return appleSecret.current();
              },
              getUserInfo: async (token: Parameters<typeof appleUserInfo>[1]) =>
                appleUserInfo(prisma, token, Boolean((await getOAuthState())?.link)),
            },
          }
        : {}),
    },
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: env.passwordAuth !== false,
      disableSignUp: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await recordSecurityEvent({
          type: "auth.password.changed",
          userId: user.id,
          metadata: { via: "/reset-password" },
        });
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: env.email
        ? async ({ user, url }, request) => {
            void emailLocaleOf({ id: user.id }, request?.headers)
              .then(async (locale) => env.email?.send(await passwordResetEmail(user, url, locale)))
              .catch((error) => env.onEmailError?.(error));
          }
        : undefined,
    },
    emailVerification: {
      sendOnSignUp: Boolean(env.email),
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: env.email
        ? async ({ user, url }, request) => {
            const verificationUrl = new URL(url);
            verificationUrl.searchParams.set(
              "callbackURL",
              new URL("/sign-in", env.webOrigin).href,
            );
            const locale = await emailLocaleOf({ id: user.id }, request?.headers);
            await env.email!.send(
              await verificationEmail(user.email, verificationUrl.href, locale),
            );
          }
        : undefined,
    },
    user: {
      additionalFields: {
        ...DEACTIVATED_AT_FIELD,
        signupSurface: attributionField,
        signupUtmSource: attributionField,
        signupUtmMedium: attributionField,
        signupUtmCampaign: attributionField,
        signupUtmContent: attributionField,
        signupUtmTerm: attributionField,
        signupReferringDomain: attributionField,
      },
      validateUserInfo: async ({ user, source }, ctx) => {
        if (source.method !== "oauth") return;
        const providerId = source.oauth?.providerId;
        const reauthentication = (await getOAuthState())?.serverContext;
        const expectedUser = reauthentication?.reauthUserId;
        if (
          typeof expectedUser === "string" &&
          (source.action !== "sign-in" || user.id !== expectedUser)
        )
          return { error: "REAUTHENTICATION_REQUIRED" };
        if (typeof expectedUser === "string") {
          const current = await sessionForAuthHook(ctx);
          if (current && current.session.token !== reauthentication?.reauthSessionToken)
            return { error: "REAUTHENTICATION_REQUIRED" };
        }
        const builtinSocial = providerId === "google" || providerId === "apple";
        if (!builtinSocial && providerId !== "oidc") return;
        const verified = user.emailVerified === true;
        const email = String(user.email ?? "").toLowerCase();
        if (isMessagingEmail(email)) return { error: "EMAIL_NOT_AVAILABLE" };
        if (source.action === "create-user") {
          const policy = await admission();
          const bypassAllowlist = providerId === "oidc" && env.oidc?.allowSignupBypass;
          if (!policy.enabled) return { error: "REGISTRATION_CLOSED" };
          if (!bypassAllowlist && !emailAllowed(email, policy.allowlist))
            return { error: "EMAIL_NOT_ALLOWED" };
          if (!verified && (builtinSocial || (!bypassAllowlist && policy.allowlist.length > 0)))
            return { error: "EMAIL_VERIFICATION_REQUIRED" };
          return;
        }
        if (builtinSocial) {
          if (source.action === "link-account") {
            if (!verified) return { error: "unable_to_link_account" };
            const target = await ctx.context.internalAdapter.findUserById(String(user.id));
            if (!target?.emailVerified) return { error: "unable_to_link_account" };
            if (target.email.toLowerCase() !== email) return { error: "email_does_not_match" };
          }
          return;
        }
        if (source.action === "link-account") {
          if (!verified) return { error: "unable_to_link_account" };
          if (!(await getOAuthState())?.link)
            return (await claimable(String(user.id))) ? undefined : { error: "account_not_linked" };
          const target = await ctx.context.internalAdapter.findUserById(String(user.id));
          if (
            !target ||
            (!target.emailVerified &&
              (env.email || (await sessionForAuthHook(ctx))?.user.id !== target.id))
          )
            return { error: "unable_to_link_account" };
          return;
        }
        if (source.action === "sign-in" && user.id) {
          const collision = await ctx.context.internalAdapter.findUserByEmail(email);
          if (collision && collision.user.id !== user.id) return { error: "account_not_linked" };
          const stored = await ctx.context.internalAdapter.findUserById(user.id);
          const credential = await ctx.context.internalAdapter.findCredentialAccount(user.id);
          if (credential?.password && stored?.email.toLowerCase() !== email)
            return { error: "email_does_not_match" };
          await ctx.context.internalAdapter.updateUser(
            user.id,
            verified || stored?.email.toLowerCase() === email
              ? { email, emailVerified: verified }
              : { emailVerified: false },
          );
        }
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          try {
            await env.beforeDeleteUser?.(user.id);
          } catch (error) {
            if (error instanceof SpaceDeletionInProgressError)
              throw new APIError("CONFLICT", { message: error.message });
            throw error;
          }
          const organizationIds = await personalOrganizationIds(prisma, user.id);

          await prisma.$transaction(async (tx) => {
            await tx.messagingIdentity.deleteMany({
              where: { userId: user.id },
            });
            await tx.passkey.deleteMany({ where: { userId: user.id } });
            await tx.organization.deleteMany({
              where: { id: { in: organizationIds } },
            });
          });
        },
        afterDelete: async (user) => {
          await recordSecurityEvent({ type: "auth.account.deleted", userId: user.id });
        },
      },
    },
    plugins: [
      socialCallbackProtection(),
      signedBearer,
      expo(),
      accountSecurity(
        env.email,
        emailLocaleOf,
        env.oidc?.name,
        env.oidc?.issuer,
        env.passwordAuth !== false,
      ),
      identityConfirmation(env.email, emailLocaleOf),
      devicePairing({ clientIpHeader: CLIENT_IP_HEADER, onPaired: env.afterDevicePaired }),
      ...(discovery ? [discovery.plugin] : []),
      ...(emailCodeSignIn
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: SIGN_IN_CODE_EXPIRES_IN_SECONDS,
              allowedAttempts: 3,
              storeOTP: "hashed",
              sendVerificationOTP: async ({ email, otp }, ctx) => {
                void emailLocaleOf({ email }, ctx?.headers)
                  .then(async (locale) =>
                    env.email?.send(await signInCodeEmail(email, otp, locale)),
                  )
                  .catch((error) => env.onEmailError?.(error));
              },
            }),
          ]
        : []),
      ...(env.breachedPasswordCheck ? [breachedPasswordCheck()] : []),
      ...(relyingParty
        ? [
            passkey({
              rpID: relyingParty.rpID,
              rpName: "RoBots",
              origin: relyingParty.origins,
            }) as BetterAuthPlugin,
          ]
        : []),
      lastLoginMethod({ cookieName: LAST_SIGN_IN_COOKIE }),
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        creatorRole: "owner",
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const providerId = requestProviderId(ctx);
        if (
          (ctx.path === "/sign-in/social" || ctx.path === "/link-social") &&
          ctx.body?.idToken &&
          (providerId === "google" || providerId === "apple")
        )
          throw new APIError("FORBIDDEN", { message: "Browser sign-in required" });

        if (ctx.path === "/sign-in/social") {
          await addOAuthServerContext({
            signupAttribution: signupAttributionFromHeaders(ctx.headers),
          });
        }
        if (
          ctx.path === "/sign-in/social" &&
          typeof providerId === "string" &&
          ctx.body?.additionalData?.reauthenticate === true
        ) {
          if (providerId !== "oidc") throw new APIError("FORBIDDEN");
          const session = await sessionForAuthHook(ctx);
          if (!session || isMessagingEmail(session.user.email)) throw new APIError("UNAUTHORIZED");
          const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
          const current = await Promise.all(
            accounts.map((account) =>
              isCurrentOidcAccount(account, env.oidc?.issuer, ctx.context.secretConfig),
            ),
          );
          const accountIds = accounts
            .filter((_, index) => current[index])
            .map((account) => account.accountId);
          if (!accountIds.length || ctx.body.idToken) throw new APIError("FORBIDDEN");
          await addOAuthServerContext({
            reauthProviderId: providerId,
            reauthUserId: session.user.id,
            reauthSessionToken: session.session.token,
            reauthAccountIds: accountIds,
            reauthStartedAt: Math.floor(Date.now() / 1_000),
          });
        }
        if (ctx.path === "/expo-authorization-proxy") {
          const authorizationURL = String(ctx.query?.authorizationURL ?? "");
          const callbackURL = (providerId: string) =>
            `${ctx.context.baseURL}/callback/${providerId}`;
          const state = URL.parse(authorizationURL)?.searchParams.get("state");
          const stateRecord = state
            ? await ctx.context.internalAdapter.findVerificationValue(
                getAuthStateVerificationIdentifier(state),
              )
            : null;
          const builtin = await Promise.all(
            (env.social?.providers ?? []).map(async (provider) => {
              const own = await ctx.context.socialProviders
                .find((candidate) => candidate.id === provider.id)
                ?.createAuthorizationURL({
                  state: "probe",
                  codeVerifier: "probe",
                  redirectURI: callbackURL(provider.id),
                  idTokenNonce: "probe",
                });
              return own !== undefined && isDefaultAuthorizationRequest(authorizationURL, own);
            }),
          );
          const own =
            builtin.some(Boolean) ||
            (await discovery?.isAuthorizationRequest(
              authorizationURL,
              callbackURL("oidc"),
              reauthenticating(stateRecord?.value),
            ));
          if (!own || !stateRecord || stateRecord.expiresAt <= new Date()) {
            throw new APIError("BAD_REQUEST", { message: "Invalid authorizationURL" });
          }
        }
        for (const value of [ctx.body?.email, ctx.body?.newEmail]) {
          if (typeof value === "string" && isMessagingEmail(value)) {
            throw new APIError("BAD_REQUEST", { message: "Email is not available" });
          }
        }
        if (
          env.passwordAuth === false &&
          [...CREDENTIAL_PATHS, "/reset-password", "/change-password", "/set-password"].includes(
            ctx.path,
          )
        ) {
          throw new APIError("FORBIDDEN", {
            code: "PASSWORD_AUTH_DISABLED",
            message: "Password authentication is disabled",
          });
        }
        if (ctx.path === "/reset-password") {
          const token = ctx.body?.token ?? ctx.query?.token;
          const reset =
            typeof token === "string"
              ? await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`)
              : null;
          const user =
            reset && reset.expiresAt > new Date()
              ? await ctx.context.internalAdapter.findUserById(reset.value)
              : null;
          if (user && !user.emailVerified) await revokeUnprovenCredentials(prisma, user.id);
        }
        if (isUnusedEmailCodePath(ctx.path, ctx.body)) throw new APIError("NOT_FOUND");
        if (ctx.path === SEND_SIGN_IN_CODE_PATH || ctx.path === CODE_SIGN_IN_PATH) {
          const email = String(ctx.body?.email ?? "")
            .trim()
            .toLowerCase();
          if (!(await ctx.context.internalAdapter.findUserByEmail(email))) {
            const policy = await emailAdmission();
            if (!policy.enabled || !emailAllowed(email, policy.allowlist)) {
              if (ctx.path === SEND_SIGN_IN_CODE_PATH) return ctx.json({ success: true });
              throw new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });
            }
          }
        }
        let policy =
          ctx.path === "/sign-up/email"
            ? await emailAdmission()
            : ctx.path === "/sign-in/email"
              ? signupPolicyFromEnv(env)
              : undefined;
        let requireEmailVerification = false;
        if (ctx.path === "/sign-up/email") {
          if (!policy?.enabled) {
            throw new APIError("BAD_REQUEST", {
              code: "REGISTRATION_CLOSED",
              message: "Registration is closed",
            });
          }
          const email = String(ctx.body?.email ?? "");
          if (!emailAllowed(email, policy.allowlist)) {
            throw new APIError("BAD_REQUEST", {
              code: "EMAIL_NOT_ALLOWED",
              message: "Email is not allowed to register",
            });
          }
          if (policy.allowlist.length > 0 && !env.email) {
            throw new APIError("BAD_REQUEST", {
              message: "Registration requires email delivery",
            });
          }
          requireEmailVerification = policy.allowlist.length > 0;
        } else if (policy) {
          requireEmailVerification = policy.allowlist.length > 0;
        }
        const { findSession, updateUser } = ctx.context.internalAdapter;
        const implicitLinking =
          env.directoryProvisioning && isOidcCallback(ctx)
            ? { disableImplicitLinking: false, requireLocalEmailVerified: false }
            : ctx.path === "/callback/:id" && providerId === "google"
              ? { disableImplicitLinking: false, requireLocalEmailVerified: true }
              : undefined;
        return {
          context: {
            context: {
              ...(policy || implicitLinking
                ? {
                    options: {
                      ...(policy ? { emailAndPassword: { requireEmailVerification } } : {}),
                      ...(implicitLinking ? { account: { accountLinking: implicitLinking } } : {}),
                    },
                  }
                : {}),
              internalAdapter: {
                ...ctx.context.internalAdapter,
                ...(ctx.path === CODE_SIGN_IN_PATH
                  ? {
                      updateUser: async (...args: Parameters<typeof updateUser>) => {
                        if (args[1].emailVerified === true)
                          await revokeUnprovenCredentials(prisma, args[0]);
                        return updateUser(...args);
                      },
                    }
                  : {}),
                findSession: async (token: string) => {
                  const session = await findSession(token);
                  if (!session || isMessagingEmail(session.user.email)) return null;
                  if (deactivated(session.user)) return null;
                  if (session.user.emailVerified) return session;
                  if (env.oidc?.allowSignupBypass) {
                    const accounts = await ctx.context.internalAdapter.findAccounts(
                      session.user.id,
                    );
                    if (accounts.some((account) => account.providerId === "oidc")) return session;
                  }
                  policy ??= signupPolicyFromEnv(env);
                  return policy.allowlist.length === 0 ? session : null;
                },
              },
            },
          },
        };
      }),
      after: createAuthMiddleware(async (ctx) => {
        const accountEvent = ACCOUNT_EVENT_PATHS[ctx.path];
        if (accountEvent && !(ctx.context.returned instanceof APIError)) {
          await recordSecurityEvent({
            type: accountEvent,
            userId: ctx.context.session?.user.id,
            metadata: { via: ctx.path },
          });
        }
        const returned = ctx.context.returned;
        if (
          (ctx.path === "/get-access-token" || ctx.path === "/refresh-token") &&
          isRecord(returned) &&
          typeof returned.idToken === "string"
        ) {
          const idToken = await openIdToken(ctx.context.secretConfig, returned.idToken);
          return ctx.json({ ...returned, idToken: idToken ?? undefined });
        }
        const redacted = withoutSessionTokens(ctx.path, returned);
        if (redacted) return ctx.json(redacted);
        const signed = withSignedSessionToken(ctx.context, returned);
        if (signed) return ctx.json(signed);
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: { ...account, idToken: await sealIdToken(await tokenKey(), account.idToken) },
          }),
        },
        update: {
          before: async (account) =>
            account.idToken === undefined
              ? undefined
              : {
                  data: {
                    ...account,
                    idToken: await sealIdToken(await tokenKey(), account.idToken),
                  },
                },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            const policy = signupPolicyFromEnv(env);
            const oidcSignIn = isOidcCallback(ctx);
            const bypassAllowlist = oidcSignIn && env.oidc?.allowSignupBypass;
            if (!user || isMessagingEmail(user.email)) {
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_VERIFICATION_REQUIRED",
                message: "Email verification required",
              });
            }
            if (deactivated(user)) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_DEACTIVATED",
                message: "This account is deactivated",
              });
            }
            if (!user.emailVerified && policy.allowlist.length > 0 && !bypassAllowlist) {
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_VERIFICATION_REQUIRED",
                message: "Email verification required",
              });
            }
            const membership = await prisma.spaceMember.findFirst({ where: { userId: user.id } });
            if (!membership) {
              if (
                (!policy.enabled ||
                  (!bypassAllowlist && !emailAllowed(user.email, policy.allowlist))) &&
                !(await provisioned(user.id))
              ) {
                throw new APIError("FORBIDDEN", {
                  code: "REGISTRATION_CLOSED",
                  message: "Registration is closed",
                });
              }
              if (!env.singleAccount) await bootstrapUserSpace(prisma, user, env);
              else if (!(await admitSoleAccount(user.id)))
                throw new APIError("FORBIDDEN", {
                  code: "REGISTRATION_CLOSED",
                  message: "Registration is closed",
                });
            }
          },
          after: async (session, ctx) => {
            await env.afterSignIn?.(session.userId, ctx?.headers);
            env.analytics?.capture(
              session.userId,
              { name: "signed_in" },
              { id: session.id, at: session.createdAt },
            );
            if (!replacedSession(ctx)) {
              await recordSecurityEvent({
                type: "auth.sign_in",
                userId: session.userId,
                ip: session.ipAddress,
                userAgent: session.userAgent,
                metadata: { via: ctx?.path ?? null },
              });
            }
            const context =
              ctx && ctx.path === "/callback/:id"
                ? (await getOAuthState())?.serverContext
                : undefined;
            if (
              ctx &&
              context?.reauthProviderId === "oidc" &&
              context.reauthUserId === session.userId &&
              typeof context.reauthExpiresAt === "number" &&
              context.reauthExpiresAt > Date.now()
            ) {
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: oidcProofKey(session.id),
                value: session.userId,
                expiresAt: new Date(context.reauthExpiresAt),
              });
              await recordSecurityEvent({
                type: "auth.identity.confirmed",
                userId: session.userId,
                metadata: {
                  method: "sso",
                  providerId: "oidc",
                },
              });
            }
            const previous = replacedSession(ctx);
            if (previous) await env.afterReplaceSession?.(previous, session);
          },
        },
        delete: {
          after: async (session, ctx) => {
            if (ctx?.path === "/sign-out") {
              await recordSecurityEvent({ type: "auth.sign_out", userId: session.userId });
            } else if (ctx?.path && REVOCATION_PATHS.has(ctx.path)) {
              await recordSecurityEvent({
                type: "auth.session.revoked",
                userId: session.userId,
                metadata: { via: ctx.path },
              });
            }
            if (replacedSession(ctx)?.id !== session.id) await env.afterDeleteSession?.(session);
          },
        },
      },
      user: {
        create: {
          after: async (user, ctx) => {
            const attribution = SignupAttribution.safeParse({
              surface: user.signupSurface ?? undefined,
              utmSource: user.signupUtmSource ?? undefined,
              utmMedium: user.signupUtmMedium ?? undefined,
              utmCampaign: user.signupUtmCampaign ?? undefined,
              utmContent: user.signupUtmContent ?? undefined,
              utmTerm: user.signupUtmTerm ?? undefined,
              referringDomain: user.signupReferringDomain ?? undefined,
            });
            env.analytics?.capture(
              user.id,
              { name: "account_created", ...(attribution.success ? attribution.data : {}) },
              { id: user.id, at: user.createdAt },
            );
            await recordSecurityEvent({
              type: "auth.sign_up",
              userId: user.id,
              metadata: { via: ctx?.path ?? null },
            });
          },
          before: async (user, ctx = null) => {
            if (isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
            const callbackAttribution = SignupAttribution.safeParse(
              ctx?.path === "/callback/:id"
                ? (await getOAuthState())?.serverContext?.signupAttribution
                : undefined,
            );
            const attribution = callbackAttribution.success
              ? callbackAttribution.data
              : signupAttributionFromHeaders(ctx?.headers);
            return {
              data: {
                ...user,
                signupSurface: attribution.surface,
                signupUtmSource: attribution.utmSource,
                signupUtmMedium: attribution.utmMedium,
                signupUtmCampaign: attribution.utmCampaign,
                signupUtmContent: attribution.utmContent,
                signupUtmTerm: attribution.utmTerm,
                signupReferringDomain: attribution.referringDomain,
                ...(user.name !== undefined ? { name: displayName(user.name, "") } : {}),
              },
            };
          },
        },
        update: {
          before: async (user) => {
            if (user.email && isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
            return {
              data: {
                ...user,
                ...(user.name !== undefined ? { name: displayName(user.name, "") } : {}),
              },
            };
          },
        },
      },
    },
  });
  authContext = auth.$context;
  return Object.assign(auth, {
    emailCodeSignIn,
    emailSignup: env.passwordAuth !== false && env.emailSignup !== false,
    encryptStoredOAuthTokens: async () => encryptStoredOAuthTokens(prisma, await tokenKey()),
    ssoAvailability: () => discovery?.availability(),
    passkeyRpId: relyingParty?.rpID ?? null,
    hasRecentIdentityConfirmation: async (session: { sessionId: string; userId: string }) =>
      hasRecentIdentityConfirmation((await auth.$context).internalAdapter, session),
    issueAccountExportToken: async (userId: string) =>
      issueAccountExportToken((await auth.$context).internalAdapter, userId),
    consumeAccountExportToken: async (token: string) =>
      consumeAccountExportToken((await auth.$context).internalAdapter, token),
    issuePairingCode: async (userId: string) =>
      issuePairingCode((await auth.$context).internalAdapter, userId),
    endSessions: async (tokens: string[]) => {
      if (tokens.length) await (await auth.$context).internalAdapter.deleteSessions(tokens);
    },
    disposeOidcDiscovery: () => {
      discovery?.dispose();
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

async function revokeUnprovenCredentials(prisma: PrismaClient, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.passkey.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId, providerId: { not: "credential" } } });
    await tx.messagingIdentity.deleteMany({ where: { userId } });
    await tx.messagingLinkCode.deleteMany({ where: { userId } });
    await tx.userDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

function replacedSession(
  ctx: { path?: string; context: { session?: { session: AuthSession } | null } } | null,
): AuthSession | undefined {
  return ctx?.path === "/change-password" ? ctx.context.session?.session : undefined;
}

function withoutSessionTokens(
  path: string,
  returned: unknown,
): Record<string, unknown> | unknown[] | undefined {
  if (path === "/list-sessions" && Array.isArray(returned)) {
    return returned.map(withoutToken);
  }
  if (
    (path === "/get-session" || path === "/update-session") &&
    isRecord(returned) &&
    isRecord(returned.session)
  ) {
    return { ...returned, session: withoutToken(returned.session) };
  }
  return undefined;
}

function withSignedSessionToken(
  context: {
    newSession: { session: { token: string } } | null;
    responseHeaders?: Headers;
    authCookies: { sessionToken: { name: string } };
  },
  returned: unknown,
): Record<string, unknown> | undefined {
  const token = context.newSession?.session.token;
  if (!token || !isRecord(returned)) return undefined;
  const cookie = parseSetCookieHeader(context.responseHeaders?.get("set-cookie") ?? "").get(
    context.authCookies.sessionToken.name,
  );
  if (!cookie?.value || cookie["max-age"] === 0) return undefined;
  const signed = decodeURIComponent(cookie.value);
  if (!signed.startsWith(`${token}.`)) return undefined;
  if (returned.token === token) return { ...returned, token: signed };
  if (isRecord(returned.session) && returned.session.token === token) {
    return { ...returned, session: { ...returned.session, token: signed } };
  }
  return undefined;
}

function withoutToken(session: unknown): unknown {
  if (!isRecord(session)) return session;
  const { token: _token, ...rest } = session;
  return rest;
}

function reauthenticating(stateValue: string | undefined): boolean {
  const state: unknown = stateValue ? JSON.parse(stateValue) : undefined;
  return (
    isRecord(state) &&
    isRecord(state.serverContext) &&
    typeof state.serverContext.reauthUserId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface TrustedOriginsInput {
  origins: string[];
  extraOrigins?: string[];
  requestOrigins?: boolean;
}

export function buildTrustedOrigins({
  origins,
  extraOrigins = [],
  requestOrigins = false,
}: TrustedOriginsInput): string[] {
  const listed = requestOrigins
    ? origins.filter((origin) => origin && origin !== APP_SCHEME_ORIGIN)
    : origins;
  const variants = listed.flatMap(requestOrigins ? requestOriginVariants : loopbackTwinOrigins);
  return [...new Set([...listed, ...extraOrigins, ...variants])];
}

const APP_SCHEME_ORIGIN = "robots://";

function requestOriginVariants(origin: string): string[] {
  const variants = loopbackTwinOrigins(origin);
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      variants.push(url.origin);
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const v6 = new URL(origin);
      v6.hostname = "[::1]";
      variants.push(v6.origin);
    }
  } catch {
    return variants;
  }
  return variants;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function loopbackTwinOrigins(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (!isLoopbackHost(url.hostname)) return [];
    const twins: string[] = [];
    for (const host of ["localhost", "127.0.0.1"] as const) {
      if (host === url.hostname) continue;
      const twin = new URL(origin);
      twin.hostname = host;
      twins.push(twin.origin);
    }
    return twins;
  } catch {
    return [];
  }
}

export function isBlockedAuthPath(path: string): boolean {
  return path.startsWith("/organization");
}

function deactivated(user: object): boolean {
  return "deactivatedAt" in user && Boolean(user.deactivatedAt);
}

function isOidcCallback(
  ctx: { path?: string; params?: Record<string, unknown> } | null | undefined,
): boolean {
  return ctx?.path === "/callback/:id" && ctx.params?.id === "oidc";
}
