import { readFileSync } from "node:fs";
import type {
  ApnsVoipConfig,
  DiscordBotCredentials,
  PhotonProjectCredentials,
  SharedMcpOAuthClient,
  TelegramBotCredentials,
} from "@robots/adapters";
import {
  apnsVoipConfig,
  boatApiKeyFromEnv,
  boatApiUrlFromEnv,
  deploymentLabsFromEnv,
  discordBotFromEnv,
  googleMcpOAuthClientFromEnv,
  mcpStdioOptionsFromEnv,
  photonProjectsFromEnv,
  resolveCloudAgentProvider,
  resolveDeploymentModel,
  resolveSandboxProvider,
  secretStoreOptionsFromEnv,
  telegramBotsFromEnv,
} from "@robots/adapters";
import type { OidcConfig, SocialAuthConfig } from "@robots/auth";
import { socialAuthFromFields } from "@robots/auth";
import type { LabFeature, MinimumClientBuilds, NavLink } from "@robots/contracts";
import { isPrivateNetworkHost, parseMinimumClientBuilds, parseNavLinks } from "@robots/contracts";
import { parseCrispWebsiteId } from "@robots/contracts/content-security-policy";
import {
  attachmentCountFromEnv,
  phoneCallSettings,
  resolveAuthSecret,
  resolveContentEncryption,
  resolveEncryptionKey,
  resolveScreenProxySecret,
  resolveSupervisorToken,
  uploadSizeFromEnv,
} from "@robots/core";
import { deploymentAdminEmails } from "@robots/db";
import { getLogger, monitoringPseudonymSecret } from "@robots/logging";

export { resolveCloudAgentProvider, resolveSandboxProvider } from "@robots/adapters";

const DEFAULT_WEB_ORIGIN = "http://127.0.0.1:5173";

export interface AppEnv {
  passwordAuth?: boolean;
  emailSignup?: boolean;
  breachedPasswordCheck?: boolean;
  oidc?: OidcConfig;
  social?: SocialAuthConfig;
  scimBearerToken?: string;
  nodeEnv: string;
  desktopStackToken?: string;
  databaseUrl: string;
  realtimeDatabaseUrl: string;
  authSecret: string;
  authUrl: string;
  webOrigin: string;
  extraAuthOrigins: string[];
  passkeyAppleAppIds: string[];
  passkeyAndroidCertFingerprints: string[];
  privacyPolicyUrl?: string;
  apiUrl: string;
  apiHost: string;
  trustedProxies: string[];
  clientIpHeader: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  encryptionKey: string;
  contentEncryption: boolean;
  dataDir: string;
  piSessionRecording: boolean;
  deploymentLabs: LabFeature[];
  userDevicesEnabled: boolean;
  computerSettingsEnabled: boolean;
  navLinks?: NavLink[];
  adminEmails: string[];
  phoneCallsEnabled: boolean;
  phoneCallRingSeconds: number;
  phoneCallCooldownMinutes: number;
  maxUploadSizeBytes: number;
  maxAttachmentsPerMessage: number;
  voiceSummaryMinChars: number | undefined;
  sandboxSupervisorUrl: string;
  sandboxSupervisorToken: string | undefined;
  screenProxySecret: string;
  sandboxProvider: string;
  cloudAgentProvider: string;
  cloudAgentSpaceId: string | undefined;
  cursorApiKey: string | undefined;
  paymentWalletProvider: string | undefined;
  paymentWalletClientId: string | undefined;
  agentRuntime: string;
  deploymentModelKey: string | undefined;
  deploymentModelConfigured: boolean;
  deploymentModelHostCredentials: boolean;
  e2bApiKey: string | undefined;
  novitaApiKey: string | undefined;
  sandboxTemplate: string | undefined;
  daytonaApiKey: string | undefined;
  daytonaApiUrl: string | undefined;
  daytonaTarget: string | undefined;
  boatApiKey: string | undefined;
  boatApiUrl: string | undefined;
  composioApiKey: string | undefined;
  integrationsCatalogUrl: string | undefined;
  pipedreamClientId: string | undefined;
  pipedreamClientSecret: string | undefined;
  pipedreamProjectId: string | undefined;
  pipedreamEnvironment: "development" | "production";
  sendblueApiKeyId: string | undefined;
  sendblueApiSecret: string | undefined;
  sendblueSigningSecret: string | undefined;
  sendbluePhoneNumber: string | undefined;
  expoAccessToken: string | undefined;
  apnsVoip?: ApnsVoipConfig;
  smtpUrl: string | undefined;
  botEmailSmtpUrl?: string;
  emailProvider?: string;
  welcomeEmailEnabled?: boolean;
  emailApiKey?: string;
  emailFrom: string | undefined;
  emailReplyTo?: string;
  inboundEmail?: { domain: string; secret: string };
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  stripePriceId: string | undefined;
  emailEmulator: boolean;
  billingEmulator: boolean;
  experiments: string | undefined;
  slackClientId?: string;
  slackClientSecret?: string;
  slackBotToken: string | undefined;
  slackSigningSecret: string | undefined;
  teamsAppId?: string;
  teamsAppPassword?: string;
  teamsAppTenantId?: string;
  whatsappAccessToken: string | undefined;
  whatsappPhoneNumberId: string | undefined;
  whatsappAppSecret: string | undefined;
  whatsappVerifyToken: string | undefined;
  telegramBotToken: string | undefined;
  telegramWebhookSecret: string | undefined;
  telegramBots?: TelegramBotCredentials[];
  larkAppId: string | undefined;
  larkAppSecret: string | undefined;
  larkVerificationToken: string | undefined;
  larkEncryptKey: string | undefined;
  larkDomain: string | undefined;
  photonProjectId: string | undefined;
  photonProjectSecret: string | undefined;
  photonWebhookSecret: string | undefined;
  photonProjects?: PhotonProjectCredentials[];
  discordBot?: DiscordBotCredentials;
  messagingOpenSignup: boolean;
  teamChatBotId: string | undefined;
  teamChatJudgeProvider: string | undefined;
  teamChatJudgeModel: string | undefined;
  defaultProvider: string;
  defaultModel: string;
  wakeupDriver: string;
  mcpStdioEnabled: boolean;
  mcpStdioAllowedCommands: string[];
  mcpStdio: ReturnType<typeof mcpStdioOptionsFromEnv>;
  mcpAllowPrivateEndpoint: boolean;
  googleMcpOAuthClient: SharedMcpOAuthClient | undefined;
  port: number;
  gitSha: string | undefined;
  minimumClientBuilds?: MinimumClientBuilds;
  browserMonitoring:
    | { dsn: string; environment?: string; release?: string; pseudonymSecret?: string }
    | undefined;
  crispWebsiteId?: string | null;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  secretStoreOptionsFromEnv(source);
  const issuer = optional(source.OIDC_ISSUER);
  const clientId = optional(source.OIDC_CLIENT_ID);
  const clientSecret = optional(source.OIDC_CLIENT_SECRET);
  const credentials = [issuer, clientId, clientSecret];
  if (credentials.some(Boolean) && !credentials.every(Boolean)) {
    throw new Error(
      "OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be configured together",
    );
  }
  if (issuer) {
    try {
      const url = new URL(issuer);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error();
    } catch {
      throw new Error("OIDC_ISSUER must be an HTTPS issuer URL");
    }
  }
  for (const key of [
    "AUTH_PASSWORD_ENABLED",
    "AUTH_EMAIL_SIGNUP_ENABLED",
    "AUTH_BREACHED_PASSWORD_CHECK_ENABLED",
    "OIDC_ALLOW_SIGNUP_BYPASS",
  ]) {
    const value = source[key];
    if (value && !["true", "false"].includes(value))
      throw new Error(`${key} must be true or false`);
  }
  const passwordAuth = source.AUTH_PASSWORD_ENABLED !== "false";
  if (!passwordAuth && !issuer)
    throw new Error("AUTH_PASSWORD_ENABLED=false requires OIDC configuration");
  const oidc =
    issuer && clientId && clientSecret
      ? {
          issuer,
          clientId,
          clientSecret,
          name: optional(source.OIDC_NAME) ?? "SSO",
          scopes: (optional(source.OIDC_SCOPES) ?? "openid email profile")
            .split(/[\s,]+/)
            .filter(Boolean),
          allowSignupBypass: source.OIDC_ALLOW_SIGNUP_BYPASS === "true",
        }
      : undefined;
  const social = socialAuthFromFields({
    googleClientId: optional(source.GOOGLE_CLIENT_ID),
    googleClientSecret: optional(source.GOOGLE_CLIENT_SECRET),
    appleClientId: optional(source.APPLE_CLIENT_ID),
    appleTeamId: optional(source.APPLE_TEAM_ID),
    appleKeyId: optional(source.APPLE_KEY_ID),
    applePrivateKey: applePrivateKey(source),
  });
  const scimBearerToken = optional(source.SCIM_BEARER_TOKEN);
  if (scimBearerToken && (scimBearerToken.length < 32 || /\s/.test(scimBearerToken)))
    throw new Error("SCIM_BEARER_TOKEN must be at least 32 characters with no spaces");
  const authSecret = resolveAuthSecret(source);
  const webOrigin = resolveWebOrigin(source.WEB_ORIGIN, DEFAULT_WEB_ORIGIN, "WEB_ORIGIN");
  const sandboxProvider = resolveSandboxProvider(source);
  const cloudAgentProvider = resolveCloudAgentProvider(source);
  const deploymentModel = resolveDeploymentModel(source);
  return {
    passwordAuth,
    emailSignup: source.AUTH_EMAIL_SIGNUP_ENABLED !== "false",
    breachedPasswordCheck: source.AUTH_BREACHED_PASSWORD_CHECK_ENABLED === "true",
    oidc,
    social,
    scimBearerToken,
    nodeEnv: source.NODE_ENV ?? "",
    databaseUrl: required(source, "DATABASE_URL"),
    realtimeDatabaseUrl: source.REALTIME_DATABASE_URL ?? required(source, "DATABASE_URL"),
    desktopStackToken: optional(source.ROBOTS_DESKTOP_STACK_TOKEN),
    authSecret,
    authUrl: resolveWebOrigin(source.BETTER_AUTH_URL, webOrigin, "BETTER_AUTH_URL"),
    webOrigin,
    extraAuthOrigins: parseExtraAuthOrigins(source.ROBOTS_EXTRA_AUTH_ORIGINS),
    passkeyAppleAppIds: list(source.PASSKEY_APPLE_APP_IDS),
    passkeyAndroidCertFingerprints: androidCertFingerprints(source.PASSKEY_ANDROID_CERT_SHA256),
    privacyPolicyUrl: optional(source.PRIVACY_POLICY_URL),
    apiUrl: source.API_URL ?? "http://127.0.0.1:3100",
    apiHost: source.API_HOST ?? "127.0.0.1",
    trustedProxies: (source.TRUSTED_PROXIES ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    clientIpHeader: optional(source.CLIENT_IP_HEADER)?.toLowerCase() ?? "x-forwarded-for",
    signupsEnabled: source.SIGNUPS_ENABLED,
    signupAllowlist: source.SIGNUP_ALLOWLIST,
    encryptionKey: resolveEncryptionKey(source),
    contentEncryption: resolveContentEncryption(source),
    dataDir: source.DATA_DIR ?? "./data",
    piSessionRecording: source.PI_SESSION_RECORDING === "true",
    deploymentLabs: deploymentLabsFromEnv(source),
    userDevicesEnabled: source.USER_DEVICES_ENABLED !== "false",
    computerSettingsEnabled: source.COMPUTER_SETTINGS_ENABLED === "true",
    navLinks: parseNavLinks(source.ROBOTS_NAV_LINKS),
    adminEmails: deploymentAdminEmails(source.ROBOTS_ADMIN_EMAILS),
    ...phoneCallSettings(source),
    maxUploadSizeBytes: uploadSizeFromEnv(source),
    maxAttachmentsPerMessage: attachmentCountFromEnv(source),
    voiceSummaryMinChars: voiceSummaryMinCharsFromEnv(source.VOICE_SUMMARY_MIN_CHARS),
    sandboxSupervisorUrl: source.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    sandboxSupervisorToken:
      sandboxProvider === "docker" ? resolveSupervisorToken(source) : undefined,
    screenProxySecret: resolveScreenProxySecret(source),
    sandboxProvider,
    cloudAgentProvider,
    cloudAgentSpaceId: optional(source.CLOUD_AGENT_SPACE_ID),
    cursorApiKey: optional(source.CURSOR_API_KEY),
    paymentWalletProvider: optional(source.PAYMENT_WALLET_PROVIDER),
    paymentWalletClientId: optional(source.PAYMENT_WALLET_CLIENT_ID),
    agentRuntime: source.AGENT_RUNTIME ?? "pi",
    deploymentModelKey: deploymentModel.key,
    deploymentModelConfigured: deploymentModel.configured,
    deploymentModelHostCredentials: deploymentModel.hostCredentials,
    e2bApiKey: source.E2B_API_KEY,
    novitaApiKey: source.NOVITA_API_KEY,
    sandboxTemplate: source.SANDBOX_TEMPLATE,
    daytonaApiKey: source.DAYTONA_API_KEY,
    daytonaApiUrl: source.DAYTONA_API_URL,
    daytonaTarget: source.DAYTONA_TARGET,
    boatApiKey: boatApiKeyFromEnv(source),
    boatApiUrl: boatApiUrlFromEnv(source),
    composioApiKey: source.COMPOSIO_API_KEY,
    integrationsCatalogUrl: optional(source.INTEGRATIONS_CATALOG_URL),
    pipedreamClientId: optional(source.PIPEDREAM_CLIENT_ID),
    pipedreamClientSecret: optional(source.PIPEDREAM_CLIENT_SECRET),
    pipedreamProjectId: optional(source.PIPEDREAM_PROJECT_ID),
    pipedreamEnvironment:
      source.PIPEDREAM_ENVIRONMENT === "production" ? "production" : "development",
    sendblueApiKeyId: optional(source.SENDBLUE_API_KEY_ID),
    sendblueApiSecret: optional(source.SENDBLUE_API_SECRET),
    sendblueSigningSecret: optional(source.SENDBLUE_SIGNING_SECRET),
    sendbluePhoneNumber: optional(source.SENDBLUE_PHONE_NUMBER),
    expoAccessToken: optional(source.EXPO_ACCESS_TOKEN),
    apnsVoip: apnsVoipConfig(source),
    smtpUrl: optional(source.SMTP_URL),
    botEmailSmtpUrl: optional(source.BOT_EMAIL_SMTP_URL),
    emailProvider: optional(source.EMAIL_PROVIDER),
    emailApiKey: optional(source.EMAIL_API_KEY),
    emailFrom: optional(source.EMAIL_FROM),
    emailReplyTo: optional(source.EMAIL_REPLY_TO),
    inboundEmail: inboundEmailFromEnv(source),
    welcomeEmailEnabled: source.WELCOME_EMAIL_ENABLED === "true",
    stripeSecretKey: optional(source.STRIPE_SECRET_KEY),
    stripeWebhookSecret: optional(source.STRIPE_WEBHOOK_SECRET),
    stripePriceId: optional(source.STRIPE_PRICE_ID),
    emailEmulator: source.EMAIL_EMULATOR === "true" && source.NODE_ENV !== "production",
    experiments: optional(source.EXPERIMENTS),
    billingEmulator: source.BILLING_EMULATOR === "true" && source.NODE_ENV !== "production",
    slackClientId: optional(source.SLACK_CLIENT_ID),
    slackClientSecret: optional(source.SLACK_CLIENT_SECRET),
    slackBotToken: optional(source.SLACK_BOT_TOKEN),
    slackSigningSecret: optional(source.SLACK_SIGNING_SECRET),
    teamsAppId: optional(source.TEAMS_APP_ID),
    teamsAppPassword: optional(source.TEAMS_APP_PASSWORD),
    teamsAppTenantId: optional(source.TEAMS_APP_TENANT_ID),
    whatsappAccessToken: optional(source.WHATSAPP_ACCESS_TOKEN),
    whatsappPhoneNumberId: optional(source.WHATSAPP_PHONE_NUMBER_ID),
    whatsappAppSecret: optional(source.WHATSAPP_APP_SECRET),
    whatsappVerifyToken: optional(source.WHATSAPP_VERIFY_TOKEN),
    telegramBotToken: optional(source.TELEGRAM_BOT_TOKEN),
    telegramWebhookSecret: optional(source.TELEGRAM_WEBHOOK_SECRET_TOKEN),
    telegramBots: telegramBotsFromEnv(source),
    larkAppId: optional(source.LARK_APP_ID),
    larkAppSecret: optional(source.LARK_APP_SECRET),
    larkVerificationToken: optional(source.LARK_VERIFICATION_TOKEN),
    larkEncryptKey: optional(source.LARK_ENCRYPT_KEY),
    larkDomain: optional(source.LARK_DOMAIN),
    discordBot: discordBotFromEnv(source),
    photonProjectId: optional(source.PHOTON_PROJECT_ID),
    photonProjectSecret: optional(source.PHOTON_PROJECT_SECRET),
    photonWebhookSecret: optional(source.PHOTON_WEBHOOK_SECRET),
    photonProjects: photonProjectsFromEnv(source),
    messagingOpenSignup: source.MESSAGING_OPEN_SIGNUP === "true",
    teamChatBotId: optional(source.TEAM_CHAT_BOT_ID) ?? optional(source.SLACK_ROBOTS_BOT_ID),
    teamChatJudgeProvider: optional(source.TEAM_CHAT_JUDGE_PROVIDER),
    teamChatJudgeModel: optional(source.TEAM_CHAT_JUDGE_MODEL),
    defaultProvider: deploymentModel.provider,
    defaultModel: deploymentModel.model,
    wakeupDriver: source.WAKEUP_DRIVER ?? "graphile",
    mcpStdioEnabled: source.MCP_STDIO_ENABLED === "true",
    mcpStdioAllowedCommands: (source.MCP_STDIO_ALLOWED_COMMANDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    mcpStdio: mcpStdioOptionsFromEnv(source),
    mcpAllowPrivateEndpoint: source.MCP_ALLOW_PRIVATE_ENDPOINT === "true",
    googleMcpOAuthClient: googleMcpOAuthClientFromEnv(source),
    port: Number(source.API_PORT ?? 3100),
    gitSha: optional(source.GIT_SHA) ?? optional(source.ROBOTS_GIT_SHA),
    minimumClientBuilds: parseMinimumClientBuilds(source.ROBOTS_MIN_CLIENT_BUILD),
    browserMonitoring: browserMonitoringFromEnv(source),
    crispWebsiteId: parseCrispWebsiteId(source.CRISP_WEBSITE_ID),
  };
}

function resolveWebOrigin(value: string | undefined, fallback: string, name: string): string {
  const origin = (optional(value) ?? fallback).replace(/\/+$/, "");
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  return origin;
}

export function parseExtraAuthOrigins(value: string | undefined): string[] {
  const origins = new Set<string>();
  for (const raw of (value ?? "").split(/[\s,]+/).filter(Boolean)) {
    try {
      const url = new URL(raw);
      const bare =
        url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
      const allowed =
        url.protocol === "https:" ||
        (url.protocol === "http:" && isPrivateNetworkHost(url.hostname));
      if (!bare || !allowed) throw new Error();
      origins.add(url.origin);
    } catch {
      getLogger().warn("ignoring invalid ROBOTS_EXTRA_AUTH_ORIGINS entry");
    }
  }
  return [...origins];
}

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function browserMonitoringFromEnv(source: NodeJS.ProcessEnv): AppEnv["browserMonitoring"] {
  const dsn = optional(source.SENTRY_BROWSER_DSN);
  if (!dsn) return undefined;
  const sha = optional(source.GIT_SHA);
  return {
    dsn,
    environment: optional(source.SENTRY_ENVIRONMENT),
    release: optional(source.SENTRY_RELEASE) ?? (sha === "unknown" ? undefined : sha),
    pseudonymSecret: monitoringPseudonymSecret(source),
  };
}

function voiceSummaryMinCharsFromEnv(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) === 0) {
    throw new Error("VOICE_SUMMARY_MIN_CHARS must be a positive whole number of characters");
  }
  return Number(raw);
}

function inboundEmailFromEnv(source: NodeJS.ProcessEnv): AppEnv["inboundEmail"] {
  const domain = optional(source.INBOUND_EMAIL_DOMAIN)?.toLowerCase();
  const secret = optional(source.INBOUND_EMAIL_SECRET);
  if (!domain && !secret) return undefined;
  if (!domain || !secret) {
    throw new Error("Set INBOUND_EMAIL_DOMAIN and INBOUND_EMAIL_SECRET together");
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("INBOUND_EMAIL_DOMAIN must be a domain name such as bots.example.com");
  }
  if (secret.length < 32) throw new Error("INBOUND_EMAIL_SECRET must be at least 32 characters");
  return { domain, secret };
}

function applePrivateKey(source: NodeJS.ProcessEnv): string | undefined {
  const inline = optional(source.APPLE_PRIVATE_KEY);
  const file = optional(source.APPLE_PRIVATE_KEY_FILE);
  if (inline && file) throw new Error("Set APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_FILE, not both");
  if (!file) return inline;
  try {
    return readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error("APPLE_PRIVATE_KEY_FILE could not be read", { cause });
  }
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

function androidCertFingerprints(value: string | undefined): string[] {
  return list(value).map((fingerprint) => {
    const hex = fingerprint.replace(/:/g, "");
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error("PASSKEY_ANDROID_CERT_SHA256 must list SHA-256 fingerprints");
    }
    return hex.toUpperCase().match(/../g)!.join(":");
  });
}
