import { generateKeyPairSync, sign } from "node:crypto";
import type * as Db from "@robots/db";
import { bootstrapUserSpace } from "@robots/db";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "./index.js";
import { createAuth } from "./index.js";

const state = vi.hoisted(() => ({ db: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => memoryAdapter(state.db) }));
vi.mock("@robots/db", async (original) => ({
  ...(await original<typeof Db>()),
  bootstrapUserSpace: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

const origin = "https://robots.example.test";
const password = "offline-password12";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const googleKey = { ...publicKey.export({ format: "jwk" }), kid: "google-key", alg: "RS256" };
let members: Set<string>;
let sent: string[];
let googleProfile: Record<string, unknown>;
let authorizedNonce: string | null;

function rows(model: string) {
  state.db[model] ??= [];
  return state.db[model]!;
}

function deployment(env: Partial<AuthEnv>) {
  const prisma: Record<string, unknown> = {
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
        members.has(where.userId) ? { userId: where.userId } : null,
      ),
    },
    user: { findUnique: vi.fn(async () => null) },
    scimUser: { findFirst: vi.fn(async () => null) },
  };
  prisma.$transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
  const auth = createAuth(prisma as never, {
    secret: "offline-test-secret-with-at-least-32-characters",
    baseURL: origin,
    webOrigin: origin,
    signupsEnabled: "true",
    signupAllowlist: "",
    social: {
      providers: [
        { id: "google", name: "Google", clientId: "google-client", clientSecret: "google-secret" },
      ],
    },
    email: {
      describe: () => ({
        id: "offline-email",
        contractVersion: "1",
        adapterVersion: "1",
        capabilities: { transactional: true },
      }),
      send: vi.fn(async (message) => {
        sent.push(message.text);
      }),
    },
    ...env,
  });
  let cookies = "";
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
  async function continueWithGoogle(profile: Record<string, unknown>) {
    googleProfile = profile;
    const started = await request("/sign-in/social", {
      provider: "google",
      callbackURL: `${origin}/app`,
      errorCallbackURL: `${origin}/sign-in`,
      disableRedirect: true,
    });
    expect(started.status, await started.clone().text()).toBe(200);
    const url = new URL(((await started.json()) as { url: string }).url);
    authorizedNonce = url.searchParams.get("nonce");
    return request(`/callback/google?state=${url.searchParams.get("state")}&code=google-code`);
  }
  return { auth, request, continueWithGoogle };
}

function googleIdToken() {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const data = `${part({ alg: "RS256", kid: "google-key" })}.${part({
    iss: "https://accounts.google.com",
    aud: "google-client",
    iat: now,
    exp: now + 300,
    sub: "google-subject",
    name: "Google person",
    nonce: authorizedNonce,
    ...googleProfile,
  })}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}

beforeEach(() => {
  googleProfile = {};
  authorizedNonce = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({ keys: [googleKey] });
      if (url.href === "https://oauth2.googleapis.com/token")
        return Response.json({
          access_token: "google-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: googleIdToken(),
        });
      throw new Error(`Unexpected offline request to ${url.href}`);
    }),
  );
  state.db = { user: [], session: [], account: [], verification: [] };
  members = new Set();
  sent = [];
  vi.mocked(bootstrapUserSpace).mockReset();
  vi.mocked(bootstrapUserSpace).mockImplementation(async (_prisma, user) => {
    members.add(user.id);
    return { spaceId: `space-${user.id}` };
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("email signup turned off", () => {
  it("refuses a password signup like closed registration and creates nothing", async () => {
    const { auth, request } = deployment({ emailSignup: false });
    const response = await request("/sign-up/email", {
      email: "newcomer@example.test",
      password,
      name: "Newcomer",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "REGISTRATION_CLOSED" });
    expect(rows("user")).toHaveLength(0);
    expect(rows("session")).toHaveLength(0);
    expect(auth.emailSignup).toBe(false);
  });

  it("keeps an existing password account signing in", async () => {
    const before = deployment({});
    expect(
      (
        await before.request("/sign-up/email", {
          email: "member@example.test",
          password,
          name: "M",
        })
      ).status,
    ).toBe(200);
    expect(before.auth.emailSignup).toBe(true);
    state.db.session = [];
    const { request } = deployment({ emailSignup: false });
    const response = await request("/sign-in/email", { email: "member@example.test", password });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(rows("user")).toHaveLength(1);
    expect(rows("session")).toHaveLength(1);
  });

  it("answers a code request for an unknown address like any other, without sending or creating", async () => {
    const { request } = deployment({ emailSignup: false });
    const unknown = await request("/email-otp/send-verification-otp", {
      email: "stranger@example.test",
      type: "sign-in",
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ success: true });
    await vi.waitFor(() => expect(sent).toHaveLength(0));
    const guessed = await request("/sign-in/email-otp", {
      email: "stranger@example.test",
      otp: "123456",
      name: "Stranger",
    });
    expect(guessed.status).toBe(400);
    expect(await guessed.json()).toMatchObject({ code: "INVALID_OTP" });
    expect(rows("user")).toHaveLength(0);
  });

  it("still sends a sign-in code to an existing account", async () => {
    await deployment({}).request("/sign-up/email", {
      email: "member@example.test",
      password,
      name: "M",
    });
    sent = [];
    const { request } = deployment({ emailSignup: false });
    const response = await request("/email-otp/send-verification-otp", {
      email: "member@example.test",
      type: "sign-in",
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(sent.join("\n")).toMatch(/\b\d{6}\b/));
  });

  it("creates a Google account with an open allowlist and gives it a workspace", async () => {
    const { continueWithGoogle } = deployment({ emailSignup: false, signupAllowlist: "" });
    const response = await continueWithGoogle({
      email: "newcomer@gmail.com",
      email_verified: true,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${origin}/app`);
    expect(rows("user")).toEqual([
      expect.objectContaining({ email: "newcomer@gmail.com", emailVerified: true }),
    ]);
    expect(rows("account")).toEqual([expect.objectContaining({ providerId: "google" })]);
    expect(rows("session")).toHaveLength(1);
    expect(bootstrapUserSpace).toHaveBeenCalledOnce();
  });

  it("refuses a Google signup while registration is closed", async () => {
    const { continueWithGoogle } = deployment({ emailSignup: false, signupsEnabled: "false" });
    const response = await continueWithGoogle({
      email: "newcomer@gmail.com",
      email_verified: true,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
    expect(response.headers.get("location")?.toLowerCase()).toContain("registration_closed");
    expect(rows("user")).toHaveLength(0);
    expect(rows("session")).toHaveLength(0);
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("refuses a Google signup the allowlist does not admit", async () => {
    const { continueWithGoogle } = deployment({
      emailSignup: false,
      signupAllowlist: "@company.test",
    });
    const response = await continueWithGoogle({
      email: "newcomer@gmail.com",
      email_verified: true,
    });
    expect(response.headers.get("location")?.toLowerCase()).toContain("email_not_allowed");
    expect(rows("user")).toHaveLength(0);
  });
});
