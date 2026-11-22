import { generateKeyPairSync, sign } from "node:crypto";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "./index.js";
import { createAuth } from "./index.js";

const state = vi.hoisted(() => ({ db: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => memoryAdapter(state.db) }));

const origin = "https://robots.example.test";
const clientId = "offline-client";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "google-key", alg: "RS256", use: "sig" };
let auth: Auth;
let cookies: string;

function googleIdToken(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: "RS256", kid: "google-key" })}.${encode({
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "google-subject",
    name: "Google user",
    iat: now,
    exp: now + 300,
    ...claims,
  })}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}

async function request(path: string, body?: unknown) {
  const response = await auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(cookies ? { cookie: cookies } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const jar = new Map(
    cookies
      .split("; ")
      .filter(Boolean)
      .map((item) => item.split("=") as [string, string]),
  );
  for (const cookie of response.headers.getSetCookie()) {
    const [key, value] = cookie.split(";")[0]!.split("=");
    if (key) jar.set(key, value ?? "");
  }
  cookies = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  return response;
}

const rows = (model: string) => state.db[model] ?? [];
const googleAccounts = () => rows("account").filter((row) => row.providerId === "google");

function passwordAccount(email: string, emailVerified: boolean) {
  const now = new Date();
  state.db.user!.push({
    id: "local-user",
    email,
    emailVerified,
    name: "Local",
    createdAt: now,
    updatedAt: now,
  });
  state.db.account!.push({
    id: "local-credential",
    userId: "local-user",
    providerId: "credential",
    accountId: "local-user",
    password: "offline-password-hash",
    createdAt: now,
    updatedAt: now,
  });
  return "local-user";
}

async function continueWithGoogle(claims: Record<string, unknown>) {
  const started = await request("/sign-in/social", {
    provider: "google",
    callbackURL: `${origin}/app`,
    errorCallbackURL: `${origin}/sign-in`,
  });
  expect(started.status, await started.clone().text()).toBe(200);
  const url = new URL(((await started.json()) as { url: string }).url);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const endpoint = new URL(input instanceof Request ? input.url : String(input)).href;
      if (endpoint === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({ keys: [jwk] });
      if (endpoint !== "https://oauth2.googleapis.com/token")
        throw new Error("Unexpected offline request");
      return Response.json({
        access_token: "offline-access",
        token_type: "Bearer",
        expires_in: 300,
        id_token: googleIdToken({ nonce: url.searchParams.get("nonce"), ...claims }),
      });
    }),
  );
  return request(`/callback/google?code=offline-code&state=${url.searchParams.get("state")}`);
}

beforeEach(() => {
  state.db = { user: [], session: [], account: [], verification: [] };
  cookies = "";
  const prisma = {
    deploymentSettings: { findUnique: async () => null },
    spaceMember: { findFirst: async () => ({ id: "existing-space" }) },
  };
  auth = createAuth(prisma as never, {
    secret: "offline-test-secret-with-at-least-32-characters",
    baseURL: origin,
    webOrigin: origin,
    signupsEnabled: "true",
    signupAllowlist: undefined,
    social: {
      providers: [{ id: "google", name: "Google", clientId, clientSecret: "offline-secret" }],
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Continue with Google on an existing password account", () => {
  it.each([
    ["a Gmail address", "owner@gmail.com", "Owner@Gmail.com", {}],
    ["a Workspace address", "owner@example.test", "owner@example.test", { hd: "example.test" }],
  ])(
    "signs a verified account in and links Google for %s",
    async (_label, localEmail, googleEmail, extra) => {
      const userId = passwordAccount(localEmail, true);
      const claims = { email: googleEmail, email_verified: true, ...extra };
      const response = await continueWithGoogle(claims);
      expect(response.headers.get("location")).toBe(`${origin}/app`);
      expect(rows("user")).toHaveLength(1);
      expect(googleAccounts()).toEqual([
        expect.objectContaining({ userId, accountId: "google-subject" }),
      ]);
      expect(await (await request("/get-session")).json()).toMatchObject({
        user: { id: userId, email: localEmail, emailVerified: true },
      });
      cookies = "";
      expect((await continueWithGoogle(claims)).headers.get("location")).toBe(`${origin}/app`);
      expect(googleAccounts()).toHaveLength(1);
    },
  );

  it.each([
    ["the existing account is unverified", "owner@gmail.com", false, true],
    ["Google has not verified the email", "owner@gmail.com", true, false],
    ["Google does not manage the mailbox", "owner@example.test", true, true],
  ])("keeps refusing when %s", async (_label, email, localVerified, googleVerified) => {
    passwordAccount(email, localVerified);
    const response = await continueWithGoogle({ email, email_verified: googleVerified });
    expect(response.headers.get("location")).toContain("error=account_not_linked");
    expect(rows("user")).toHaveLength(1);
    expect(googleAccounts()).toHaveLength(0);
    expect(rows("session")).toHaveLength(0);
    expect(await (await request("/get-session")).json()).toBeNull();
  });
});
