import { describe, expect, it } from "vitest";
import { botSecretDestinationSchema, VaultPutInput } from "./bot-secrets.js";
import { ImportSessionsInput, sessionOriginSite, sessionSiteOrigin } from "./browser-sessions.js";
import { VAULT_KINDS, VAULT_NEW_KINDS, vaultKind } from "./vault-items.js";

const cookie = {
  name: "auth_token",
  value: "fake",
  domain: "x.com",
  hostOnly: false,
  path: "/",
  secure: true,
  httpOnly: true,
};

describe("signed-in sessions", () => {
  it("can never be asked for by a bot or saved by hand", () => {
    const destination = { name: "x-session", origin: "https://x.com", auth: { type: "session" } };
    expect(botSecretDestinationSchema().safeParse(destination).success).toBe(false);
    expect(VaultPutInput.safeParse({ destination, value: JSON.stringify([cookie]) }).success).toBe(
      false,
    );
  });

  it("is listed and filtered like any kind, but not offered as New", () => {
    expect(vaultKind("session")).toBe("session");
    expect(VAULT_KINDS).toContain("session");
    expect(VAULT_NEW_KINDS).not.toContain("session");
  });

  it("accepts one session per site whose cookies all belong to it", () => {
    const input = { source: "Thomas in Chrome", botIds: ["bot-1"], sessions: [] as unknown[] };
    expect(
      ImportSessionsInput.safeParse({ ...input, sessions: [{ site: "x.com", cookies: [cookie] }] })
        .success,
    ).toBe(true);
    expect(
      ImportSessionsInput.safeParse({
        ...input,
        sessions: [
          { site: "x.com", cookies: [cookie] },
          { site: "x.com", cookies: [cookie] },
        ],
      }).success,
    ).toBe(false);
    expect(
      ImportSessionsInput.safeParse({
        ...input,
        sessions: [{ site: "x.com", cookies: [{ ...cookie, domain: "evilx.com" }] }],
      }).success,
    ).toBe(false);
  });

  it("stores a site as its HTTPS origin and reads it back", () => {
    expect(sessionSiteOrigin("x.com")).toBe("https://x.com");
    expect(sessionOriginSite("https://x.com")).toBe("x.com");
    expect(sessionOriginSite("http://x.com")).toBeUndefined();
  });
});
