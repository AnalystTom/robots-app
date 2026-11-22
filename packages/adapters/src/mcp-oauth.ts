import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  auth,
  discoverOAuthProtectedResourceMetadata,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SecretStore } from "@robots/adapter-kit";
import { SecretStoreUnavailableError } from "@robots/adapter-kit";
import {
  isLocalhostOrLoopbackIp,
  MCP_OAUTH_CLIENT_REQUIRED,
  mcpOAuthEnvReferences,
  parseMcpOAuthAuthorizationParams,
} from "@robots/contracts";
import { readBoundedResponseBytes } from "@robots/core";
import type { Prisma, PrismaClient } from "@robots/db";
import { availableInSpace, itemSecretIn, runAsSystem } from "@robots/db";
import { getLogger } from "@robots/logging";
import { advisoryLock } from "./advisory-lock.js";
import { sanitizeConnectorError } from "./connector-safety.js";
import { MCP_DYNAMIC_REGISTRATION_UNSUPPORTED, needsMcpOAuthClient } from "./mcp-server-health.js";
import {
  MAX_AUTHORIZATION_URL_LENGTH,
  secureFetch,
  validateUrl,
  withEndpointOriginFallback,
} from "./mcp-transport.js";
import { REFRESH_REQUEST_TIMEOUT_MS, withRefreshLock } from "./refresh-lock.js";
import type { RemoteTransportDependencies } from "./remote-mcp.js";
import { persistPreparedSecret } from "./secret-persistence.js";
import { deleteSecretBestEffort, holdSecretNotifications } from "./secret-store-factory.js";

type OAuthState = {
  tokens?: OAuthTokens;
  obtainedAt?: number;
  clientInformation?: OAuthClientInformationMixed;
  discoveryState?: OAuthDiscoveryState;
  redirectUri?: string;
  codeVerifier?: string;
};

export type OAuthMaterial = {
  secret?: string;
  args?: string[];
  env?: Record<string, string>;
  files?: Record<string, string>;
  headers?: Record<string, string>;
  oauthClient?: PreRegisteredClient;
  oauth?: OAuthState;
  oauthGeneration?: number;
};

export function oauthMaterialSecrets(material: OAuthMaterial): string[] {
  const values: string[] = [];
  const add = (value: string | undefined) => addSecret(values, value);
  add(material.secret);
  add(material.oauth?.tokens?.access_token);
  add(material.oauth?.tokens?.refresh_token);
  add(material.oauthClient?.client_secret);
  const client = material.oauth?.clientInformation;
  if (client && "client_secret" in client && typeof client.client_secret === "string") {
    add(client.client_secret);
  }
  for (const [key, value] of Object.entries(material.headers ?? {})) {
    if (isAuthHeaderKey(key) || isConfiguredSecret(key, value)) add(value);
  }
  for (const [key, value] of Object.entries(material.env ?? {})) {
    if (isConfiguredSecret(key, value)) add(value);
  }
  for (const content of Object.values(material.files ?? {})) {
    if (
      mcpOAuthEnvReferences(content).fields.length === 0 &&
      looksLikeSecretValue(content, { allowNumeric: false })
    )
      add(content);
  }
  return [...new Set(values)];
}

function addSecret(values: string[], value: string | undefined): void {
  if (!value) return;
  values.push(value);
  const bearer = value.match(/^(?:Bearer|Basic)\s+(.+)$/i);
  if (bearer?.[1]) values.push(bearer[1]);
}

export function launchArgSecrets(args: string[]): string[] {
  const values: string[] = [];
  const add = (value: string | undefined) => addSecret(values, value);
  const addAssignment = (assignment: string) => {
    const match = assignment.match(/^([A-Za-z_][\w.-]*)=([\s\S]*)$/);
    if (match?.[1] && match[2] && isLaunchSecret(match[1], match[2])) add(match[2]);
  };
  for (const [index, arg] of args.entries()) {
    for (const url of urlsIn(arg)) values.push(...urlSecrets(url));
    const flag = arg.match(/^--?([A-Za-z][\w.-]*)(?:=([\s\S]*))?$/);
    if (!flag?.[1]) {
      addAssignment(arg);
      continue;
    }
    const name = flag[1];
    const next = args[index + 1];
    const value = flag[2] ?? (next?.startsWith("-") ? undefined : next);
    if (!value) continue;
    const normalized = snakeName(name);
    if (name === "H" || normalized === "header") {
      const header = value.match(/^([^:]+):\s*([\s\S]*)$/);
      if (!header?.[1] || !header[2]) continue;
      const [, headerName, headerValue] = header;
      if (isAuthHeaderKey(headerName) && /^bearer$/i.test(headerValue)) {
        const token = args[index + 2];
        if (flag[2] === undefined && !/^(--|-.$)/.test(token ?? "")) add(token);
      } else if (
        isAuthHeaderKey(headerName) ||
        (!/^(accept|content|user-agent|cache-control|connection|host)/i.test(headerName.trim()) &&
          isLaunchSecret(headerName, headerValue))
      ) {
        add(headerValue);
      }
    } else if (name === "e" || normalized === "env") {
      addAssignment(value);
    } else if (name.length === 1) {
      if (name !== "y" && looksLikeOpaqueToken(value)) add(value);
    } else if (isCredentialArg(name, value)) {
      add(value);
    }
  }
  return [...new Set(values)];
}

function isLaunchSecret(name: string, value: string): boolean {
  return isConfiguredSecret(snakeName(name), value) || isCredentialArg(name, value);
}

function isCredentialArg(name: string, value: string): boolean {
  const normalized = snakeName(name);
  return (
    isCredentialName(normalized) &&
    looksLikeSecretValue(value, {
      allowNumeric: isExplicitCredentialKey(normalized) || NAMED_KEY.test(normalized),
    })
  );
}

const NAMED_KEY = /(?:^|_)(access_key|private_key|secret_key)$/;

function isCredentialName(normalized: string): boolean {
  return (
    isExplicitCredentialKey(normalized) ||
    isAmbiguousCredentialKey(normalized) ||
    NAMED_KEY.test(normalized) ||
    /^(key|pat|auth)$/.test(normalized) ||
    (/_auth$/.test(normalized) && !/^(no|disable|enable|skip|use|require)_/.test(normalized))
  );
}

function snakeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])|([A-Z])([A-Z][a-z])/g, (_, a, b, c, d) =>
      a ? `${a}_${b}` : `${c}_${d}`,
    )
    .toLowerCase()
    .replace(/[-.]/g, "_");
}

function looksLikeOpaqueToken(value: string): boolean {
  return /^[\w+=.-]{16,}$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value);
}

function urlsIn(text: string): string[] {
  const urls: string[] = [];
  for (const word of text.split(/[\s"'<>]+/)) {
    const separator = word.indexOf("://");
    let start = separator;
    while (start > 0 && /[a-z\d+.-]/i.test(word.charAt(start - 1))) start--;
    while (start < separator && !/[a-z]/i.test(word.charAt(start))) start++;
    if (start < separator) urls.push(word.slice(start));
  }
  return urls;
}

function urlSecrets(text: string): string[] {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return [];
  }
  const values: string[] = [];
  const addEncoded = (value: string) => values.push(value, decodeURIComponentSafe(value));
  if (url.password) addEncoded(url.password);
  const username = decodeURIComponentSafe(url.username);
  if (
    !url.password && /^https?:$/.test(url.protocol)
      ? username.length >= MIN_NEUTRAL_SECRET_LENGTH
      : looksLikeOpaqueToken(username)
  )
    addEncoded(url.username);
  for (const pair of url.search.slice(1).split("&")) {
    const [[key, value] = []] = new URLSearchParams(pair);
    if (!key || !value) continue;
    if (isCredentialArg(key, value)) {
      addSecret(values, value);
      values.push(pair.slice(pair.indexOf("=") + 1));
    }
  }
  return values;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MIN_NEUTRAL_SECRET_LENGTH = 8;

function isConfiguredSecret(key: string, value: string): boolean {
  if (isExplicitCredentialKey(key)) return looksLikeSecretValue(value, { allowNumeric: true });
  if (!looksLikeSecretValue(value, { allowNumeric: false })) return false;
  return isAmbiguousCredentialKey(key) || value.trim().length >= MIN_NEUTRAL_SECRET_LENGTH;
}

function isAuthHeaderKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/-/g, "_");
  return (
    normalized === "authorization" ||
    normalized === "proxy_authorization" ||
    normalized === "cookie" ||
    normalized === "set_cookie" ||
    normalized === "x_session" ||
    normalized === "x_api_key" ||
    normalized === "api_key" ||
    normalized === "x_auth_token"
  );
}

function isExplicitCredentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/-/g, "_");
  if (isAuthHeaderKey(key)) return true;
  return /(?:^|_)(secret|password|credential|access_token|refresh_token|id_token|auth_token|session_token|session_id|session_key|session_secret|api_key|api_token)$/.test(
    normalized,
  );
}

function isAmbiguousCredentialKey(key: string): boolean {
  if (isExplicitCredentialKey(key)) return false;
  const normalized = key.toLowerCase().replace(/-/g, "_");
  if (/(?:^|_)token$/.test(normalized)) {
    return !/(timeout|ttl|max|count|type|mode|name)$/.test(normalized);
  }
  return false;
}

export function looksLikeSecretValue(
  value: string,
  options: { allowNumeric?: boolean } = {},
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (COMMON_CONFIG_VALUES.has(trimmed.toLowerCase())) return false;
  if (!options.allowNumeric && /^\d+(\.\d+)?$/.test(trimmed)) return false;
  return true;
}

const COMMON_CONFIG_VALUES = new Set([
  "production",
  "development",
  "staging",
  "test",
  "testing",
  "oauth",
  "openid",
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
  "none",
  "null",
  "debug",
  "info",
  "warn",
  "error",
  "http",
  "https",
  "local",
  "localhost",
  "enabled",
  "disabled",
  "default",
  "auto",
  "manual",
  "read",
  "write",
  "sync",
  "async",
]);

type PreRegisteredClient = OAuthClientInformation & {
  authorization_server?: string;
  scope?: string;
  authorization_params?: string;
};

export type SharedMcpOAuthClient = { client_id: string; client_secret: string };

const GOOGLE_AUTHORIZATION_SERVER = "https://accounts.google.com/";
const GOOGLE_OFFLINE_AUTHORIZATION_PARAMS = "access_type=offline&prompt=consent";

export function googleMcpOAuthClientFromEnv(
  source: NodeJS.ProcessEnv,
): SharedMcpOAuthClient | undefined {
  const clientId = source.GOOGLE_MCP_OAUTH_CLIENT_ID?.trim();
  const clientSecret = source.GOOGLE_MCP_OAUTH_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error(
      "GOOGLE_MCP_OAUTH_CLIENT_ID and GOOGLE_MCP_OAUTH_CLIENT_SECRET must be configured together",
    );
  return clientId && clientSecret
    ? { client_id: clientId, client_secret: clientSecret }
    : undefined;
}

function sharedMcpOAuthClientSecrets(googleClient: SharedMcpOAuthClient | undefined) {
  return googleClient ? [googleClient.client_secret] : [];
}

function effectiveMcpOAuthClient(
  material: OAuthMaterial,
  googleClient: SharedMcpOAuthClient | undefined,
): PreRegisteredClient | undefined {
  if (material.oauthClient) return material.oauthClient;
  const discovered = material.oauth?.discoveryState?.authorizationServerUrl;
  if (!googleClient || !discovered || new URL(discovered).href !== GOOGLE_AUTHORIZATION_SERVER)
    return undefined;
  return {
    ...googleClient,
    authorization_server: GOOGLE_AUTHORIZATION_SERVER,
    authorization_params: GOOGLE_OFFLINE_AUTHORIZATION_PARAMS,
  };
}

function boundClient(
  client: PreRegisteredClient,
  authorizationServerUrl: string | undefined,
): OAuthClientInformation {
  if (!authorizationServerUrl) throw new Error("MCP OAuth authorization server is unknown");
  if (
    client.authorization_server &&
    client.authorization_server !== new URL(authorizationServerUrl).href
  )
    throw new McpOAuthServerMismatchError();
  const {
    authorization_server: _bound,
    scope: _scope,
    authorization_params: _params,
    ...information
  } = client;
  return information;
}

type ServerRef = { id: string; endpoint: string | null; secretId: string | null };
type ActorRef = { spaceId: string; userId: string };

class McpCredentialRefusedError extends Error {}

function isCredentialRefusal(error: unknown): boolean {
  return error instanceof McpCredentialRefusedError || error instanceof McpOAuthServerMismatchError;
}

export class McpOAuthServerMismatchError extends Error {
  constructor() {
    super(
      "MCP OAuth authorization server differs from the one this client was first used with; reconfigure the server's OAuth client",
    );
    this.name = "McpOAuthServerMismatchError";
  }
}

export class McpOAuthClientRequiredError extends Error {
  readonly code = MCP_OAUTH_CLIENT_REQUIRED;
  constructor(readonly revision: number) {
    super(MCP_DYNAMIC_REGISTRATION_UNSUPPORTED);
    this.name = "McpOAuthClientRequiredError";
  }
}

export class McpReauthorizationRequiredError extends Error {
  readonly code = "MCP_REAUTHORIZATION_REQUIRED";
  constructor(readonly serverId: string) {
    super("MCP authorization expired. Reconnect this server in MCP settings.");
    this.name = "McpReauthorizationRequiredError";
  }
}

type TokenGrant = Pick<OAuthState, "tokens" | "obtainedAt">;

type PersistMaterial = (
  material: OAuthMaterial,
  storedRefreshToken?: string | null,
) => Promise<TokenGrant | undefined>;

type ProviderOptions = {
  redirectUri?: string;
  state?: string;
  onAuthorization?: (url: URL) => void;
  onPersisted?: (record: { id: string; ref: string; material: OAuthMaterial }) => void;
  refresh?: (heldRefreshToken: string) => Promise<TokenGrant>;
  allowPrivateEndpoint?: boolean;
  googleClient?: SharedMcpOAuthClient;
};

export const TOKEN_REFRESH_SKEW_MS = 60_000;

const OFFLINE_ACCESS = "offline_access";

export function accessTokenExpiresAt(oauth: OAuthState | undefined): number | undefined {
  const lifetimeSeconds = oauth?.tokens?.expires_in;
  if (oauth?.obtainedAt === undefined || lifetimeSeconds === undefined) return undefined;
  return oauth.obtainedAt + lifetimeSeconds * 1000;
}

function accessTokenExpired(oauth: OAuthState | undefined): boolean {
  const expiresAt = accessTokenExpiresAt(oauth);
  return (
    Boolean(oauth?.tokens?.refresh_token) &&
    expiresAt !== undefined &&
    Date.now() >= expiresAt - TOKEN_REFRESH_SKEW_MS
  );
}

function canonicalResource(
  resource: string | undefined,
  allowPrivateEndpoint = false,
): URL | undefined {
  if (!resource) return undefined;
  try {
    return validateUrl(resource, { allowPrivateEndpoint });
  } catch {
    return undefined;
  }
}

function requestOfflineAccess(
  authorizationUrl: URL,
  discovery: OAuthDiscoveryState | undefined,
): void {
  const scope = authorizationUrl.searchParams.get("scope");
  if (!scope) return;
  if (!discovery?.authorizationServerMetadata?.scopes_supported?.includes(OFFLINE_ACCESS)) return;
  const scopes = scope.split(/\s+/);
  if (scopes.includes(OFFLINE_ACCESS)) return;
  authorizationUrl.searchParams.set("scope", [...scopes, OFFLINE_ACCESS].join(" "));
}

const REGISTRATION_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];

function registrationAuthMethod(discovery: OAuthDiscoveryState | undefined): string | undefined {
  const advertised = discovery?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
  if (!Array.isArray(advertised) || advertised.length === 0) return undefined;
  const usable = REGISTRATION_AUTH_METHODS.find((method) => advertised.includes(method));
  if (!usable)
    throw new Error(
      `${MCP_DYNAMIC_REGISTRATION_UNSUPPORTED} with a client-authentication method this client can perform; it accepts only ${advertised.join(", ")}`,
    );
  return usable;
}

function applyGrant(oauth: OAuthState, grant: TokenGrant): void {
  if (grant.tokens) oauth.tokens = grant.tokens;
  else delete oauth.tokens;
  if (grant.obtainedAt) oauth.obtainedAt = grant.obtainedAt;
  else delete oauth.obtainedAt;
}

export class StoredMcpOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  private readonly runtimeState = randomUUID();
  private persistQueue = Promise.resolve();
  private refreshing?: Promise<void>;
  private served?: OAuthTokens;
  private storedRefreshToken: string | null;

  constructor(
    readonly serverId: string,
    private readonly material: OAuthMaterial,
    private readonly persistMaterial: PersistMaterial,
    private readonly options: ProviderOptions = {},
  ) {
    this.storedRefreshToken = material.oauth?.tokens?.refresh_token ?? null;
    if (options.redirectUri) {
      this.material.oauth = { ...(this.material.oauth ?? {}), redirectUri: options.redirectUri };
    }
  }

  get redirectUrl(): string | undefined {
    return this.options.redirectUri ?? this.material.oauth?.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    const redirectUri = this.redirectUrl;
    if (!redirectUri) throw new McpReauthorizationRequiredError(this.serverId);
    const hostname = new URL(redirectUri).hostname;
    const applicationType = hostname === "localhost" || hostname === "127.0.0.1" ? "native" : "web";
    const authMethod = this.oauthClient()
      ? undefined
      : registrationAuthMethod(this.material.oauth?.discoveryState);
    return {
      redirect_uris: [redirectUri],
      client_name: "RoBots",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(authMethod ? { token_endpoint_auth_method: authMethod } : {}),
      application_type: applicationType,
      ...(this.configuredScope ? { scope: this.configuredScope } : {}),
    } as OAuthClientMetadata;
  }

  get configuredScope(): string | undefined {
    return this.oauthClient()?.scope;
  }

  private oauthClient(): PreRegisteredClient | undefined {
    return effectiveMcpOAuthClient(this.material, this.options.googleClient);
  }

  private usesDeploymentClient(): boolean {
    return !this.material.oauthClient && Boolean(this.oauthClient());
  }

  state(): string {
    return this.options.state ?? this.runtimeState;
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    const client = this.oauthClient();
    if (!client) {
      const information = this.material.oauth?.clientInformation;
      if (
        information &&
        "redirect_uris" in information &&
        this.options.onAuthorization &&
        this.redirectUrl &&
        !information.redirect_uris.includes(this.redirectUrl)
      )
        return undefined;
      return information;
    }
    const server = this.material.oauth?.discoveryState?.authorizationServerUrl;
    const information = boundClient(client, server);
    const stored = this.material.oauthClient;
    if (stored && !stored.authorization_server && server)
      this.material.oauthClient = { ...stored, authorization_server: new URL(server).href };
    return information;
  }
  adoptClientBinding(stored: PreRegisteredClient | undefined): void {
    const client = this.material.oauthClient;
    const bound = stored?.authorization_server;
    if (!client || !bound || !sameOAuthClient(client, stored)) return;
    this.material.oauthClient = { ...client, authorization_server: bound };
  }
  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    if (this.usesDeploymentClient()) return;
    this.oauth().clientInformation = value;
    await this.persist();
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    if (this.options.refresh && accessTokenExpired(this.material.oauth)) {
      await this.renew().catch(() => undefined);
    }
    return this.material.oauth?.tokens;
  }

  wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
      const body = init?.body instanceof URLSearchParams ? init.body : undefined;
      if (!this.options.refresh || body?.get("grant_type") !== "refresh_token")
        return fetch(input, init);
      if (body.get("refresh_token") === this.material.oauth?.tokens?.refresh_token) {
        try {
          await this.renew();
        } catch {
          return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
        }
      }
      const tokens = this.material.oauth?.tokens;
      this.served = tokens;
      return tokens
        ? Response.json(tokens)
        : Response.json({ error: "invalid_grant" }, { status: 400 });
    };
  }

  async replaceRejectedToken(): Promise<void> {
    const held = this.material.oauth?.tokens;
    await this.renew();
    const tokens = this.material.oauth?.tokens;
    if (tokens && tokens !== held) return;
    if (tokens) await this.invalidateCredentials("tokens");
    throw new McpReauthorizationRequiredError(this.serverId);
  }

  private renew(): Promise<void> {
    this.refreshing ??= this.refreshHeldGrant().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refreshHeldGrant(): Promise<void> {
    const oauth = this.material.oauth;
    const held = oauth?.tokens;
    if (!oauth || !held?.refresh_token || !this.options.refresh) return;
    let grant: TokenGrant;
    try {
      grant = await this.options.refresh(held.refresh_token);
    } catch (error) {
      if (isCredentialRefusal(error) && this.material.oauth === oauth && oauth.tokens === held)
        applyGrant(oauth, {});
      throw error;
    }
    if (this.material.oauth !== oauth || oauth.tokens !== held) return;
    applyGrant(oauth, grant);
    this.storedRefreshToken = grant.tokens?.refresh_token ?? null;
  }

  async saveTokens(value: OAuthTokens): Promise<void> {
    const oauth = this.oauth();
    if (this.served && oauth.tokens === this.served && isDeepStrictEqual(value, this.served))
      return;
    oauth.tokens = value;
    oauth.obtainedAt = Date.now();
    await this.persist(true);
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    let authorizationUrl: URL;
    try {
      authorizationUrl = validateUrl(url, {
        allowHttpLocalhost: true,
        allowPrivateEndpoint: this.options.allowPrivateEndpoint,
        maxUrlLength: MAX_AUTHORIZATION_URL_LENGTH,
      });
    } catch (error) {
      if (!this.options.onAuthorization) {
        await this.invalidateCredentials("tokens");
      }
      throw error;
    }
    const extra = this.oauthClient()?.authorization_params;
    if (extra) {
      for (const [key, value] of Object.entries(parseMcpOAuthAuthorizationParams(extra)))
        if (!authorizationUrl.searchParams.has(key)) authorizationUrl.searchParams.set(key, value);
    }
    requestOfflineAccess(authorizationUrl, this.material.oauth?.discoveryState);
    if (authorizationUrl.href.length > MAX_AUTHORIZATION_URL_LENGTH) {
      if (!this.options.onAuthorization) await this.invalidateCredentials("tokens");
      throw new Error(`MCP authorization URL exceeds ${MAX_AUTHORIZATION_URL_LENGTH} characters`);
    }
    this.authorizationUrl = authorizationUrl;
    if (this.options.onAuthorization) {
      this.options.onAuthorization(authorizationUrl);
      return;
    }
    await this.invalidateCredentials("tokens");
    throw new McpReauthorizationRequiredError(this.serverId);
  }
  async saveCodeVerifier(value: string): Promise<void> {
    this.oauth().codeVerifier = value;
    await this.persist();
  }
  codeVerifier(): string {
    const verifier = this.material.oauth?.codeVerifier;
    if (!verifier) throw new Error("OAuth PKCE verifier is missing");
    return verifier;
  }
  async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    return canonicalResource(resource, this.options.allowPrivateEndpoint);
  }
  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    this.oauth().discoveryState = value;
    await this.persist();
  }
  accessTokenExpiresAt(): number | undefined {
    return accessTokenExpiresAt(this.material.oauth);
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.material.oauth?.discoveryState;
  }
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      const redirectUri = this.redirectUrl;
      this.material.oauth = redirectUri ? { redirectUri } : undefined;
    } else if (this.material.oauth) {
      if (scope === "client") delete this.material.oauth.clientInformation;
      if (scope === "tokens") {
        delete this.material.oauth.tokens;
        delete this.material.oauth.obtainedAt;
      }
      if (scope === "verifier") delete this.material.oauth.codeVerifier;
      if (scope === "discovery") delete this.material.oauth.discoveryState;
    }
    await this.persist();
  }

  private oauth(): OAuthState {
    if (!this.material.oauth) this.material.oauth = {};
    return this.material.oauth;
  }

  private async persist(issued = false): Promise<void> {
    const snapshot = structuredClone(this.material);
    const held = this.material.oauth?.tokens;
    const storedRefreshToken = issued ? undefined : this.storedRefreshToken;
    const next = this.persistQueue.then(async () => {
      const kept = await this.persistMaterial(snapshot, storedRefreshToken);
      const oauth = this.material.oauth;
      if (kept && oauth && oauth.tokens === held) applyGrant(oauth, kept);
      this.storedRefreshToken = (kept ?? snapshot.oauth)?.tokens?.refresh_token ?? null;
    });
    this.persistQueue = next.catch(() => undefined);
    await next;
  }
}

type Pending = {
  serverId: string;
  spaceId: string;
  userId: string;
  endpoint: string;
  stdio: boolean;
  generation: number;
  provider: StoredMcpOAuthProvider;
  createdAt: number;
  expiry?: ReturnType<typeof setTimeout>;
};

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING_SESSIONS = 100;

function oauthFetch(
  endpoint: string,
  network: RemoteTransportDependencies,
  material: OAuthMaterial = {},
  allowPrivateEndpoint = false,
  deploymentSecrets: string[] = [],
): {
  fetch: typeof fetch;
  close: () => Promise<void>;
  headers: Record<string, string>;
  publicError: (error: unknown, message: string) => Error;
} {
  const url = new URL(endpoint);
  const localHttp = url.protocol === "http:" && isLocalhostOrLoopbackIp(url.hostname);
  const headers = {
    ...material.headers,
    ...(material.secret
      ? {
          Authorization: material.secret.startsWith("Bearer ")
            ? material.secret
            : `Bearer ${material.secret}`,
        }
      : {}),
  };
  const safeFetch = secureFetch(
    url,
    {
      allowHttpLocalhost: localHttp,
      allowLocalHttpCredentials: localHttp,
      allowPrivateEndpoint,
    },
    { headers },
    network,
  );
  const fallbackFetch = withEndpointOriginFallback(url.origin, safeFetch);
  const networkErrors = new WeakSet<Error>();
  let rejection: OAuthRejection | undefined;
  const recordingFetch: typeof fetch = async (input, init) => {
    try {
      const response = await fallbackFetch(input, init);
      if (!response.ok) {
        const next = await readOAuthRejection(response);
        if (next) rejection = next;
      }
      return response;
    } catch (error) {
      if (error instanceof Error) networkErrors.add(error);
      throw error;
    }
  };
  return {
    headers,
    fetch: recordingFetch,
    close: () => safeFetch.close(),
    publicError: (error, message) => {
      if (error instanceof Error && networkErrors.has(error)) return error;
      const secrets = [...oauthMaterialSecrets(material), ...deploymentSecrets];
      const sdk = sanitizeConnectorError(error, secrets);
      const surfaced = rejection ? formatOAuthRejection(rejection, sdk, secrets) : undefined;
      getLogger().warn(`${message}: ${surfaced ?? sdk}`);
      return new Error(surfaced ? `${message}: ${surfaced}` : message);
    },
  };
}

async function startAdvertisedAuthorization(
  provider: StoredMcpOAuthProvider,
  serverUrl: URL,
  fetchFn: typeof fetch,
): Promise<void> {
  let resourceMetadata: Awaited<ReturnType<typeof discoverOAuthProtectedResourceMetadata>>;
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, undefined, fetchFn);
  } catch {
    return;
  }
  const advertised = resourceMetadata.authorization_servers?.[0];
  if (!advertised) return;
  await provider.saveDiscoveryState({ authorizationServerUrl: advertised, resourceMetadata });
  await auth(provider, withScope({ serverUrl, fetchFn }, provider));
}

function withScope<T extends object>(options: T, provider: StoredMcpOAuthProvider): T {
  return provider.configuredScope ? { ...options, scope: provider.configuredScope } : options;
}

async function authorizeAtIssuer(
  provider: StoredMcpOAuthProvider,
  authorizationServer: string,
  fetchFn: typeof fetch,
  authorizationCode?: string,
): Promise<void> {
  if (authorizationCode === undefined)
    await provider.saveDiscoveryState({ authorizationServerUrl: authorizationServer });
  await auth(
    provider,
    withScope(
      {
        serverUrl: new URL(authorizationServer),
        fetchFn,
        ...(authorizationCode === undefined ? {} : { authorizationCode }),
      },
      provider,
    ),
  );
}

async function startRemoteAuthorization(
  provider: StoredMcpOAuthProvider,
  endpoint: URL,
  network: ReturnType<typeof oauthFetch>,
  authorizationStarted: () => boolean,
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: network.headers },
    authProvider: provider,
    fetch: provider.wrapFetch(network.fetch),
  });
  const client = new Client({ name: "robots-oauth", version: "0.1.0" });
  const signal = AbortSignal.timeout(15_000);
  try {
    await client.connect(transport, { signal, timeout: 15_000 });
    if (!authorizationStarted() && !(await provider.tokens()))
      await startAdvertisedAuthorization(provider, endpoint, provider.wrapFetch(network.fetch));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function withoutRequestCredentials(material: OAuthMaterial): OAuthMaterial {
  const { secret: _secret, headers: _headers, ...rest } = material;
  return rest;
}

type OAuthRejection = { status: number; code: string; description: string };

const OAUTH_ERROR_BODY_MAX_CHARS = 8_000;
const OAUTH_ERROR_BODY_MAX_BYTES = OAUTH_ERROR_BODY_MAX_CHARS * 3;

async function readOAuthRejection(response: Response): Promise<OAuthRejection | undefined> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > OAUTH_ERROR_BODY_MAX_BYTES) {
    return undefined;
  }
  let text: string;
  try {
    const bytes = await readBoundedResponseBytes(response.clone(), {
      maxBytes: OAUTH_ERROR_BODY_MAX_BYTES,
      tooLargeMessage: "OAuth error response is too large",
      read: (operation) => operation(),
    });
    text = new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
  if (text.length > OAUTH_ERROR_BODY_MAX_CHARS) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const code = record.error;
  if (typeof code !== "string" || !/^[\w.-]{1,64}$/.test(code)) return undefined;
  const description = typeof record.error_description === "string" ? record.error_description : "";
  return { status: response.status, code, description };
}

function formatOAuthRejection(
  rejection: OAuthRejection,
  sdk: string,
  secrets: string[],
): string | undefined {
  if (sdk.includes("Raw body:")) return undefined;
  const cleaned = sanitizeConnectorError(rejection.description, secrets);
  if (cleaned.trim() !== sdk.trim()) return undefined;
  const description = cleaned.replace(/\s+/g, " ").trim().slice(0, 300);
  const detail = description ? `${rejection.code}: ${description}` : rejection.code;
  return sanitizeConnectorError(`HTTP ${rejection.status} ${detail}`, secrets);
}

type MaterialSnapshot = {
  server: { endpoint: string | null; secretId: string | null };
  secret: { id: string; ciphertext: string } | null;
};

export function lockMcpOAuthMaterial(
  tx: Prisma.TransactionClient,
  serverId: string,
): Promise<unknown> {
  return advisoryLock(tx, "mcp-oauth-material", serverId);
}

async function requestRefresh(
  material: OAuthMaterial,
  googleClient: SharedMcpOAuthClient | undefined,
  refreshToken: string,
  fetchFn: typeof fetch,
  allowPrivateEndpoint: boolean,
): Promise<OAuthTokens> {
  const discovery = material.oauth?.discoveryState;
  const client = effectiveMcpOAuthClient(material, googleClient);
  const clientInformation = client
    ? boundClient(client, discovery?.authorizationServerUrl)
    : material.oauth?.clientInformation;
  if (!discovery?.authorizationServerUrl || !clientInformation)
    throw new Error("MCP OAuth state cannot refresh");
  return refreshAuthorization(discovery.authorizationServerUrl, {
    metadata: discovery.authorizationServerMetadata,
    clientInformation,
    refreshToken,
    resource: canonicalResource(discovery.resourceMetadata?.resource, allowPrivateEndpoint),
    fetchFn: (input, init) =>
      fetchFn(input, { ...init, signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS) }),
  });
}

function sameOAuthClient(
  left: PreRegisteredClient | undefined,
  right: PreRegisteredClient | undefined,
): boolean {
  const bound = left?.authorization_server && right?.authorization_server;
  return (
    left?.client_id === right?.client_id &&
    left?.client_secret === right?.client_secret &&
    left?.scope === right?.scope &&
    left?.authorization_params === right?.authorization_params &&
    (!bound || left?.authorization_server === right?.authorization_server)
  );
}

function flowAuthorizationServer(material: OAuthMaterial): string | undefined {
  const bound = material.oauthClient?.authorization_server;
  if (bound) return bound;
  const discovered = material.oauth?.discoveryState?.authorizationServerUrl;
  return discovered ? new URL(discovered).href : undefined;
}

function conflictsWithBinding(stored: PreRegisteredClient | undefined, flow: OAuthMaterial) {
  const bound = stored?.authorization_server;
  const target = flowAuthorizationServer(flow);
  return Boolean(bound && target && bound !== target);
}

export type McpOAuthSummary = {
  status: "none" | "connected" | "reconnect";
  clientId: string | null;
  sharedClient: boolean;
  credential: boolean;
};

function hasCredential(material: OAuthMaterial): boolean {
  return Boolean(
    material.secret ||
      material.args?.length ||
      Object.keys(material.env ?? {}).length ||
      Object.keys(material.files ?? {}).length ||
      Object.keys(material.headers ?? {}).length ||
      material.oauthClient ||
      material.oauth,
  );
}

function summarize(
  material: OAuthMaterial,
  googleClient: SharedMcpOAuthClient | undefined,
): McpOAuthSummary {
  const status = material.oauth?.tokens ? "connected" : material.oauth ? "reconnect" : "none";
  return {
    status,
    clientId: material.oauthClient?.client_id ?? null,
    sharedClient: !material.oauthClient && Boolean(effectiveMcpOAuthClient(material, googleClient)),
    credential: hasCredential(material),
  };
}

export class McpOAuthBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly secrets: SecretStore,
    private readonly network: RemoteTransportDependencies = {},
    private readonly allowPrivateEndpoint = false,
    private readonly googleClient?: SharedMcpOAuthClient,
  ) {}

  secretsIn(material: OAuthMaterial): string[] {
    return [...oauthMaterialSecrets(material), ...sharedMcpOAuthClientSecrets(this.googleClient)];
  }

  private oauthFetch(endpoint: string, material: OAuthMaterial = {}) {
    return oauthFetch(
      endpoint,
      this.network,
      material,
      this.allowPrivateEndpoint,
      sharedMcpOAuthClientSecrets(this.googleClient),
    );
  }

  async statusFor(server: ServerRef, context: ActorRef): Promise<McpOAuthSummary["status"]> {
    return (await this.summaryFor(server, context)).status;
  }

  async summaryFor(server: ServerRef, context: ActorRef): Promise<McpOAuthSummary> {
    const { material } = await this.loadMaterial(server, context);
    return summarize(material, this.googleClient);
  }

  async summaryForCiphertext(
    ciphertext: string | undefined,
    recordId: string | undefined,
  ): Promise<McpOAuthSummary> {
    return summarize(
      ciphertext && recordId ? await this.read(ciphertext, recordId) : {},
      this.googleClient,
    );
  }

  async providerFor(
    server: ServerRef,
    context: ActorRef,
    loaded?: { material: OAuthMaterial; secretId?: string },
    onPersisted?: ProviderOptions["onPersisted"],
  ): Promise<StoredMcpOAuthProvider | undefined> {
    const material = loaded ?? (await this.loadMaterial(server, context));
    if (!material.material.oauth) return undefined;
    return this.createProvider(server, context, material, { onPersisted });
  }

  async begin(input: {
    serverId: string;
    spaceId: string;
    userId: string;
    redirectUri: string;
  }): Promise<
    | { status: "authorization_required"; sessionId: string; authorizationUrl: string }
    | { status: "already_connected" | "authorization_not_requested" }
  > {
    const server = await this.prisma.mcpServer.findFirst({
      where: {
        id: input.serverId,
        ...availableInSpace(input),
        enabled: true,
      },
    });
    if (!server) throw new Error("MCP server endpoint is required for OAuth");
    const context = { spaceId: input.spaceId, userId: input.userId };
    const loaded = await this.loadMaterial(server, context);
    const target =
      server.endpoint ??
      effectiveMcpOAuthClient(loaded.material, this.googleClient)?.authorization_server;
    if (!target) throw new Error("MCP server endpoint is required for OAuth");
    await this.sweepExpiredPending();
    let actorPending = 0;
    for (const pending of this.pending.values()) {
      if (pending.spaceId === input.spaceId && pending.userId === input.userId) {
        actorPending += 1;
      }
    }
    if (actorPending >= MAX_PENDING_SESSIONS) {
      throw new Error("Too many pending MCP authorization attempts; wait and try again");
    }
    const activeCount = await this.prisma.mcpOAuthSession.count({
      where: { spaceId: input.spaceId, userId: input.userId },
    });
    if (activeCount >= MAX_PENDING_SESSIONS) {
      throw new Error("Too many pending MCP authorization attempts; wait and try again");
    }
    const sessionId = randomUUID();
    let authorizationUrl: URL | undefined;
    const provider = this.createProvider(server, context, loaded, {
      redirectUri: input.redirectUri,
      state: sessionId,
      onAuthorization: (url) => {
        authorizationUrl = url;
      },
    });
    const networkFetch = this.oauthFetch(
      target,
      server.endpoint ? loaded.material : withoutRequestCredentials(loaded.material),
    );
    try {
      if (server.endpoint)
        await startRemoteAuthorization(
          provider,
          new URL(server.endpoint),
          networkFetch,
          () => authorizationUrl !== undefined,
        );
      else {
        const tokens = await provider.tokens();
        const expiresAt = accessTokenExpiresAt(loaded.material.oauth);
        if (!tokens || (expiresAt !== undefined && Date.now() >= expiresAt))
          await authorizeAtIssuer(provider, target, provider.wrapFetch(networkFetch.fetch));
      }
    } catch (error) {
      if (error instanceof McpOAuthServerMismatchError) throw error;
      if (needsMcpOAuthClient(error)) throw new McpOAuthClientRequiredError(server.revision);
      if (!authorizationUrl) throw networkFetch.publicError(error, "Could not start MCP OAuth");
    } finally {
      await networkFetch.close().catch(() => undefined);
    }
    if (!authorizationUrl) {
      if (await provider.tokens()) {
        return { status: "already_connected" };
      }
      return { status: "authorization_not_requested" };
    }
    const sessionMaterial = await this.secrets.put(
      JSON.stringify(loaded.material),
      {
        operationId: "mcp.oauth.session",
        traceId: "mcp.oauth.session",
        spaceId: input.spaceId,
        userId: input.userId,
        botId: "mcp",
        signal: new AbortController().signal,
      },
      { recordId: sessionId, ephemeral: true },
    );
    await this.prisma.mcpOAuthSession.create({
      data: {
        id: sessionId,
        serverId: server.id,
        spaceId: input.spaceId,
        userId: input.userId,
        endpoint: target,
        redirectUri: input.redirectUri,
        oauthCiphertext: sessionMaterial.ciphertext,
      },
    });
    const expiry = setTimeout(() => {
      this.pending.delete(sessionId);
      void this.prisma.mcpOAuthSession
        .deleteMany({ where: { id: sessionId } })
        .catch(() => undefined);
    }, PENDING_TTL_MS);
    expiry.unref?.();
    this.pending.set(sessionId, {
      serverId: server.id,
      spaceId: input.spaceId,
      userId: input.userId,
      endpoint: target,
      stdio: !server.endpoint,
      generation: loaded.material.oauthGeneration ?? 0,
      provider,
      createdAt: Date.now(),
      expiry,
    });
    return {
      status: "authorization_required",
      sessionId,
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async complete(input: {
    sessionId: string;
    code: string;
    state: string;
    spaceId: string;
    userId: string;
  }): Promise<{ serverId: string; revision: number }> {
    await this.sweepExpiredPending();
    if (input.state !== input.sessionId) {
      throw new Error("MCP OAuth session is invalid or expired");
    }
    let pending = this.pending.get(input.sessionId);
    if (pending && (pending.spaceId !== input.spaceId || pending.userId !== input.userId)) {
      pending = undefined;
    }
    if (!pending) {
      const session = await this.prisma.mcpOAuthSession.findFirst({
        where: {
          id: input.sessionId,
          spaceId: input.spaceId,
          userId: input.userId,
          createdAt: { gte: new Date(Date.now() - PENDING_TTL_MS) },
        },
      });
      if (!session) throw new Error("MCP OAuth session is invalid or expired");
      const server = await this.prisma.mcpServer.findFirst({
        where: {
          id: session.serverId,
          ...availableInSpace(input),
          enabled: true,
        },
      });
      if (!server) throw new Error("MCP OAuth session is invalid or expired");
      const context = { spaceId: input.spaceId, userId: input.userId };
      const loaded = {
        material: await this.read(session.oauthCiphertext, session.id),
        ...(server.secretId ? { secretId: server.secretId } : {}),
      };
      pending = {
        serverId: server.id,
        spaceId: input.spaceId,
        userId: input.userId,
        endpoint: session.endpoint,
        stdio: !server.endpoint,
        generation: loaded.material.oauthGeneration ?? 0,
        provider: this.createProvider(server, context, loaded, {
          redirectUri: session.redirectUri,
          state: session.id,
        }),
        createdAt: session.createdAt.getTime(),
        expiry: undefined,
      };
    }
    this.pending.delete(input.sessionId);
    if (pending.expiry) clearTimeout(pending.expiry);
    const consumed = await this.prisma.mcpOAuthSession.deleteMany({
      where: {
        id: input.sessionId,
        spaceId: input.spaceId,
        userId: input.userId,
      },
    });
    if (consumed.count !== 1) throw new Error("MCP OAuth session is invalid or expired");
    const current = await this.prisma.mcpServer.findFirst({
      where: { id: pending.serverId, ...availableInSpace(input) },
      select: { id: true, endpoint: true, secretId: true },
    });
    if (current) {
      const stored = await this.loadMaterial(current, input);
      pending.provider.adoptClientBinding(stored.material.oauthClient);
    }
    const networkFetch = this.oauthFetch(pending.endpoint, {
      oauth: { clientInformation: pending.provider.clientInformation() },
    });
    try {
      if (pending.stdio)
        await authorizeAtIssuer(pending.provider, pending.endpoint, networkFetch.fetch, input.code);
      else {
        const transport = new StreamableHTTPClientTransport(new URL(pending.endpoint), {
          authProvider: pending.provider,
          fetch: networkFetch.fetch,
        });
        try {
          await transport.finishAuth(input.code);
        } finally {
          await transport.close().catch(() => undefined);
        }
      }
    } catch (error) {
      throw networkFetch.publicError(error, "Could not complete MCP OAuth");
    } finally {
      await networkFetch.close().catch(() => undefined);
    }
    const tokens = await pending.provider.tokens();
    const { revision } = await withRefreshLock(
      this.prisma,
      (tx) => lockMcpOAuthMaterial(tx, pending.serverId),
      async (tx) => {
        const endpoint = pending.stdio ? null : pending.endpoint;
        const snapshot = await this.snapshot(tx, pending.serverId, input, endpoint);
        const material = snapshot.secret
          ? await this.read(snapshot.secret.ciphertext, snapshot.secret.id)
          : {};
        if ((material.oauthGeneration ?? 0) !== pending.generation)
          throw new Error("MCP OAuth session is invalid or expired");
        if (!tokens) throw new Error("MCP OAuth authorization failed");
        return tx.mcpServer.update({
          where: { id: pending.serverId },
          data: { revision: { increment: 1 } },
        });
      },
    );
    return { serverId: pending.serverId, revision };
  }

  private async sweepExpiredPending(): Promise<void> {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [sessionId, pending] of this.pending) {
      if (pending.createdAt < cutoff) {
        this.discardPending(sessionId, pending);
      }
    }
    await runAsSystem("expire abandoned MCP sign-ins in every Space", () =>
      this.prisma.mcpOAuthSession.deleteMany({ where: { createdAt: { lt: new Date(cutoff) } } }),
    );
  }

  private discardPending(sessionId: string, pending: Pending): void {
    if (pending.expiry) clearTimeout(pending.expiry);
    this.pending.delete(sessionId);
  }

  async disconnect(input: {
    serverId: string;
    spaceId: string;
    userId: string;
  }): Promise<number | undefined> {
    for (const [sessionId, pending] of this.pending) {
      if (
        pending.serverId === input.serverId &&
        pending.spaceId === input.spaceId &&
        pending.userId === input.userId
      )
        this.discardPending(sessionId, pending);
    }
    await this.prisma.mcpOAuthSession.deleteMany({
      where: { serverId: input.serverId, spaceId: input.spaceId, userId: input.userId },
    });
    const server = await this.prisma.mcpServer.findFirst({
      where: { id: input.serverId, ...availableInSpace(input) },
    });
    if (!server) return undefined;
    const row = server.secretId
      ? await this.prisma.secret.findFirst({
          where: { id: server.secretId, ...itemSecretIn(input) },
        })
      : null;
    const material = row ? await this.read(row.ciphertext, row.id) : {};
    delete material.oauth;
    let revision: number | undefined;
    await this.replaceMaterial(server.id, material, input, {
      incrementRevision: true,
      raiseGeneration: true,
      onCommitted: (committed) => {
        revision = committed;
      },
    });
    return revision;
  }

  private async loadMaterial(
    server: ServerRef,
    context: ActorRef,
  ): Promise<{ material: OAuthMaterial; secretId?: string }> {
    if (!server.secretId) return { material: {} };
    const row = await this.prisma.secret.findFirst({
      where: { id: server.secretId, ...itemSecretIn(context) },
    });
    return row
      ? { material: await this.read(row.ciphertext, row.id), secretId: row.id }
      : { material: {} };
  }

  private createProvider(
    server: ServerRef,
    context: ActorRef,
    loaded: { material: OAuthMaterial; secretId?: string },
    options: ProviderOptions = {},
  ): StoredMcpOAuthProvider {
    const endpoint = server.endpoint;
    const target =
      endpoint ?? effectiveMcpOAuthClient(loaded.material, this.googleClient)?.authorization_server;
    return new StoredMcpOAuthProvider(
      server.id,
      loaded.material,
      (material, storedRefreshToken) =>
        this.replaceMaterial(server.id, material, context, {
          expectedEndpoint: endpoint,
          onPersisted: options.onPersisted,
          storedRefreshToken,
        }),
      {
        ...(target
          ? {
              refresh: (held: string) =>
                holdSecretNotifications(() =>
                  this.refreshGrant(
                    server.id,
                    endpoint,
                    target,
                    context,
                    held,
                    options.onPersisted,
                  ),
                ),
            }
          : {}),
        allowPrivateEndpoint: this.allowPrivateEndpoint,
        googleClient: this.googleClient,
        ...options,
      },
    );
  }

  private async refreshGrant(
    serverId: string,
    endpoint: string | null,
    target: string,
    context: ActorRef,
    held: string,
    onPersisted?: ProviderOptions["onPersisted"],
  ): Promise<TokenGrant> {
    const network = this.oauthFetch(target);
    let stored: { id: string; ciphertext: string } | undefined;
    let rotated: { material: OAuthMaterial; grant: TokenGrant; spent: string } | undefined;
    try {
      const result = await persistPreparedSecret(
        this.prisma,
        this.secrets,
        undefined,
        () =>
          withRefreshLock(
            this.prisma,
            (tx) => lockMcpOAuthMaterial(tx, serverId),
            async (tx) => {
              const snapshot = await this.snapshot(tx, serverId, context, endpoint);
              const material = snapshot.secret
                ? await this.read(snapshot.secret.ciphertext, snapshot.secret.id)
                : {};
              const oauth = material.oauth;
              const current = oauth?.tokens?.refresh_token;
              if (!oauth || !current || (current !== held && !accessTokenExpired(oauth)))
                return { grant: { tokens: oauth?.tokens, obtainedAt: oauth?.obtainedAt } };
              let grant: TokenGrant;
              try {
                grant = {
                  tokens: await requestRefresh(
                    material,
                    this.googleClient,
                    current,
                    network.fetch,
                    this.allowPrivateEndpoint,
                  ),
                };
                grant.obtainedAt = Date.now();
              } catch (error) {
                if (!(error instanceof InvalidGrantError)) throw error;
                grant = {};
              }
              applyGrant(oauth, grant);
              if (grant.tokens) rotated = { material, grant, spent: current };
              stored = await this.putMaterial(material, context);
              if (!(await this.commitMaterial(tx, serverId, context, snapshot, stored)))
                throw new Error("MCP credentials changed during refresh; retry");
              return { grant, record: { id: stored.id, ref: stored.ciphertext, material } };
            },
          ),
        (result) => {
          if (result.record) onPersisted?.(result.record);
        },
      );
      return result.grant;
    } catch (error) {
      if (stored) await deleteSecretBestEffort(this.secrets, stored.ciphertext, stored.id);
      if (isCredentialRefusal(error) || !rotated) throw error;
      getLogger().warn("MCP OAuth refresh commit failed; storing the rotated grant again");
      let observed: TokenGrant | undefined;
      try {
        const kept = await this.replaceMaterial(serverId, rotated.material, context, {
          expectedEndpoint: endpoint,
          onPersisted,
          storedRefreshToken: rotated.spent,
          replaceCleared: true,
          onKept: (grant) => {
            observed = grant;
          },
        });
        return kept ?? rotated.grant;
      } catch (fallbackError) {
        if (isCredentialRefusal(fallbackError)) throw fallbackError;
        return observed ?? rotated.grant;
      }
    } finally {
      await network.close().catch(() => undefined);
    }
  }

  private async replaceMaterial(
    serverId: string,
    material: OAuthMaterial,
    context: ActorRef,
    options: {
      incrementRevision?: boolean;
      expectedEndpoint?: string | null;
      onPersisted?: ProviderOptions["onPersisted"];
      storedRefreshToken?: string | null;
      replaceCleared?: boolean;
      raiseGeneration?: boolean;
      onKept?: (grant: TokenGrant) => void;
      onCommitted?: (revision: number) => void;
    } = {},
  ): Promise<TokenGrant | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = await this.prisma.$transaction((tx) =>
        this.snapshot(tx, serverId, context, options.expectedEndpoint),
      );
      const nextMaterial = snapshot.secret
        ? await this.read(snapshot.secret.ciphertext, snapshot.secret.id)
        : {};
      const storedOAuth = nextMaterial.oauth;
      let kept: TokenGrant | undefined;
      if (material.oauth) {
        if (!sameOAuthClient(material.oauthClient, nextMaterial.oauthClient))
          throw new McpCredentialRefusedError(
            "MCP OAuth client changed during authorization; reconnect this server",
          );
        if (conflictsWithBinding(nextMaterial.oauthClient, material))
          throw new McpOAuthServerMismatchError();
        const superseded = (material.oauthGeneration ?? 0) !== (nextMaterial.oauthGeneration ?? 0);
        const bound = material.oauthClient?.authorization_server;
        if (
          !superseded &&
          nextMaterial.oauthClient &&
          bound &&
          !nextMaterial.oauthClient.authorization_server
        )
          nextMaterial.oauthClient = { ...nextMaterial.oauthClient, authorization_server: bound };
        nextMaterial.oauth = structuredClone(material.oauth);
        const staleClear = options.replaceCleared && storedOAuth && !storedOAuth.tokens;
        if (
          superseded ||
          (options.storedRefreshToken !== undefined &&
            (storedOAuth?.tokens?.refresh_token ?? null) !== options.storedRefreshToken &&
            !staleClear)
        ) {
          kept = { tokens: storedOAuth?.tokens, obtainedAt: storedOAuth?.obtainedAt };
          options.onKept?.(kept);
          if (superseded && storedOAuth) {
            nextMaterial.oauth = structuredClone(storedOAuth);
          } else if (storedOAuth) applyGrant(nextMaterial.oauth, kept);
          else delete nextMaterial.oauth;
        }
      } else delete nextMaterial.oauth;
      if (options.raiseGeneration) {
        nextMaterial.oauthGeneration = (nextMaterial.oauthGeneration ?? 0) + 1;
      } else {
        nextMaterial.oauthGeneration =
          Math.max(material.oauthGeneration ?? 0, nextMaterial.oauthGeneration ?? 0) || undefined;
      }
      const hasMaterial = hasCredential(nextMaterial) || Boolean(nextMaterial.oauthGeneration);
      const stored = hasMaterial ? await this.putMaterial(nextMaterial, context) : undefined;
      const committed = await persistPreparedSecret(
        this.prisma,
        this.secrets,
        stored,
        () =>
          this.prisma.$transaction(async (tx) => {
            await lockMcpOAuthMaterial(tx, serverId);
            return this.commitMaterial(
              tx,
              serverId,
              context,
              snapshot,
              stored,
              options.incrementRevision,
            );
          }),
        (committed) => {
          if (committed && stored)
            options.onPersisted?.({
              id: stored.id,
              ref: stored.ciphertext,
              material: nextMaterial,
            });
        },
      );
      if (committed) {
        options.onCommitted?.(committed.revision);
        return kept;
      }
    }
    throw new McpCredentialRefusedError("MCP credentials changed during authorization; retry");
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    serverId: string,
    context: ActorRef,
    expectedEndpoint?: string | null,
  ): Promise<MaterialSnapshot> {
    const server = await tx.mcpServer.findFirst({
      where: { id: serverId, ...availableInSpace(context) },
      select: { endpoint: true, secretId: true },
    });
    if (!server) throw new McpCredentialRefusedError("MCP server is unavailable");
    if (expectedEndpoint !== undefined && server.endpoint !== expectedEndpoint)
      throw new McpCredentialRefusedError(
        "MCP server endpoint changed during authorization; reconnect this server",
      );
    const secret = server.secretId
      ? await tx.secret.findFirst({
          where: { id: server.secretId, ...itemSecretIn(context) },
        })
      : null;
    return { server, secret };
  }

  private putMaterial(
    material: OAuthMaterial,
    context: ActorRef,
  ): Promise<{ id: string; ciphertext: string }> {
    return this.secrets.put(JSON.stringify(material), {
      operationId: "mcp.oauth.persist",
      traceId: "mcp.oauth.persist",
      spaceId: context.spaceId,
      userId: context.userId,
      botId: "mcp",
      signal: new AbortController().signal,
    });
  }

  private async commitMaterial(
    tx: Prisma.TransactionClient,
    serverId: string,
    context: ActorRef,
    snapshot: MaterialSnapshot,
    stored: { id: string; ciphertext: string } | undefined,
    incrementRevision = false,
  ): Promise<false | { revision: number }> {
    const server = await tx.mcpServer.findFirst({
      where: { id: serverId, ...availableInSpace(context) },
      select: { endpoint: true, secretId: true, spaceId: true, allSpaces: true },
    });
    if (!server) throw new McpCredentialRefusedError("MCP server is unavailable");
    if (
      server.endpoint !== snapshot.server.endpoint ||
      server.secretId !== snapshot.server.secretId
    )
      return false;
    if (server.secretId)
      await tx.$queryRaw`SELECT id FROM secrets WHERE id = ${server.secretId} FOR UPDATE`;
    const current = server.secretId
      ? await tx.secret.findFirst({
          where: { id: server.secretId, ...itemSecretIn(context) },
        })
      : null;
    if (current?.ciphertext !== snapshot.secret?.ciphertext) return false;
    const shared =
      server.allSpaces ||
      server.spaceId !== context.spaceId ||
      (await tx.mcpServerSpace.count({ where: { serverId } })) > 0;
    if (stored)
      await tx.secret.create({
        data: {
          id: stored.id,
          spaceId: shared ? null : context.spaceId,
          userId: context.userId,
          kind: "mcp",
          ciphertext: stored.ciphertext,
        },
      });
    const { revision } = await tx.mcpServer.update({
      where: { id: serverId },
      data: {
        secretId: stored?.id ?? null,
        ...(incrementRevision ? { revision: { increment: 1 } } : {}),
      },
    });
    if (server.secretId && server.secretId !== stored?.id)
      await tx.secret.deleteMany({ where: { id: server.secretId } });
    return { revision };
  }

  private async read(ciphertext: string, recordId: string): Promise<OAuthMaterial> {
    try {
      const value = JSON.parse(await this.secrets.load(ciphertext, recordId));
      return value && typeof value === "object" ? (value as OAuthMaterial) : {};
    } catch (error) {
      if (error instanceof SecretStoreUnavailableError) throw error;
      return {};
    }
  }
}
