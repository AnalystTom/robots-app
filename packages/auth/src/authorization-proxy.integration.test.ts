import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "./index.js";
import { createAuth } from "./index.js";

const state = vi.hoisted(() => ({ db: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => memoryAdapter(state.db) }));

const baseURL = "https://robots.example.test";
const googleClientId = "robots-client.apps.googleusercontent.com";
const googleAuthorize = "https://accounts.google.com/o/oauth2/v2/auth";
const ownCallback = `${baseURL}/api/auth/callback/google`;
let auth: Auth;

beforeEach(() => {
  state.db = { user: [], session: [], account: [], verification: [] };
  auth = createAuth({ deploymentSettings: { findUnique: async () => null } } as never, {
    secret: "offline-test-secret-with-at-least-32-characters",
    baseURL,
    webOrigin: baseURL,
    signupsEnabled: "true",
    signupAllowlist: undefined,
    social: {
      providers: [
        {
          id: "google",
          name: "Google",
          clientId: googleClientId,
          clientSecret: "offline-google-secret",
        },
      ],
    },
  });
});

async function nativeSignIn() {
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: "robots://", "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "robots://sign-in",
        errorCallbackURL: "robots://sign-in",
        disableRedirect: true,
      }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { url: string }).url;
}

function proxy(authorizationURL: string, oauthState?: string) {
  const query = new URLSearchParams({ authorizationURL });
  if (oauthState) query.set("oauthState", oauthState);
  return auth.handler(new Request(`${baseURL}/api/auth/expo-authorization-proxy?${query}`));
}

function googleRequest(params: Record<string, string>) {
  return `${googleAuthorize}?${new URLSearchParams({
    response_type: "code",
    scope: "openid",
    state: "probe",
    ...params,
  })}`;
}

describe("native authorization proxy", () => {
  it("forwards the authorization request this server just issued", async () => {
    const url = await nativeSignIn();
    expect(new URL(url).searchParams.get("client_id")).toBe(googleClientId);
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(ownCallback);
    const response = await proxy(url);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(url);
  });

  it.each([
    [
      "a foreign client",
      { client_id: "not-robots.apps.googleusercontent.com", redirect_uri: ownCallback },
    ],
    ["a foreign redirect", { client_id: googleClientId, redirect_uri: "https://example.com/cb" }],
    [
      "a foreign client and redirect",
      {
        client_id: "not-robots.apps.googleusercontent.com",
        redirect_uri: "https://example.com/cb",
      },
    ],
    ["no client", { redirect_uri: ownCallback }],
    [
      "a callback for another provider",
      { client_id: googleClientId, redirect_uri: `${baseURL}/api/auth/callback/apple` },
    ],
  ])("refuses %s", async (_, params) => {
    const response = await proxy(googleRequest(params));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses a RoBots request whose state this server never issued", async () => {
    const url = await nativeSignIn();
    const forged = new URL(url);
    forged.searchParams.set("state", "never-issued");
    const response = await proxy(forged.href);
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a RoBots request whose state has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const url = await nativeSignIn();
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const response = await proxy(url);
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a RoBots request with an extra parameter the server did not emit", async () => {
    const url = new URL(await nativeSignIn());
    url.searchParams.set("login_hint", "someone@example.test");
    const response = await proxy(url.href);
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a RoBots request whose scope was changed", async () => {
    const url = new URL(await nativeSignIn());
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive");
    const response = await proxy(url.href);
    expect(response.status).toBe(400);
  });

  it("refuses a request that repeats its client", async () => {
    const response = await proxy(
      `${googleRequest({ client_id: googleClientId, redirect_uri: ownCallback })}&client_id=not-robots.apps.googleusercontent.com`,
    );
    expect(response.status).toBe(400);
  });

  it("checks the request before setting a carried OAuth state", async () => {
    const url = await nativeSignIn();
    const foreign = new URL(url);
    foreign.searchParams.set("client_id", "not-robots.apps.googleusercontent.com");
    const refused = await proxy(foreign.href, "carried-state");
    expect(refused.status).toBe(400);
    expect(refused.headers.getSetCookie()).toEqual([]);
    const forwarded = await proxy(url, "carried-state");
    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get("location")).toBe(url);
    expect(forwarded.headers.getSetCookie().join()).toContain("oauth_state=carried-state");
  });
});
