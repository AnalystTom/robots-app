import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSandboxProvider } from "@robots/adapters";
import { runAsSystem } from "@robots/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "../../../packages/testkit/src/index.js";
import type { CapturedMail, SmtpCapture } from "../../../packages/testkit/src/smtp-capture.js";
import { startSmtpCapture } from "../../../packages/testkit/src/smtp-capture.js";
import type { AppHandles } from "./app.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;
const publicOrigin = "https://app.tryrobots.app";
const sender = "RoBots <no-reply@tryrobots.app>";
const smtpLogin = { user: "resend", password: "re_offline_capture_only" };

describe.skipIf(!databaseUrl)("account email over SMTP", () => {
  let handles: AppHandles;
  let dataDir: string;
  let smtp: SmtpCapture;
  const stamp = Date.now();
  let accounts = 0;

  beforeAll(async () => {
    smtp = await startSmtpCapture();
    dataDir = await mkdtemp(join(tmpdir(), "robots-account-email-"));
    handles = await createApp({
      databaseUrl: databaseUrl!,
      dataDir,
      sandboxProvider: "fake",
      sandbox: new FakeSandboxProvider(),
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      signupAllowlist: "",
      webOrigin: publicOrigin,
      authUrl: publicOrigin,
      smtpUrl: smtp.smtpsUrl(smtpLogin.user, smtpLogin.password),
      emailFrom: sender,
    });
  });

  afterAll(async () => {
    await handles?.stop();
    await smtp?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function auth(path: string, body: object) {
    return handles.app.request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: publicOrigin },
      body: JSON.stringify(body),
    });
  }

  const signIn = (email: string, password: string) => auth("/sign-in/email", { email, password });

  async function mailTo(address: string, subject: string): Promise<CapturedMail> {
    return vi.waitFor(
      () => {
        const mail = smtp.messages.findLast(
          (message) =>
            message.envelope.to.includes(address) && message.headers.get("subject") === subject,
        );
        if (!mail) throw new Error(`No "${subject}" email for ${address} yet`);
        return mail;
      },
      { timeout: 10_000 },
    );
  }

  function linkIn(mail: CapturedMail): URL {
    const link = mail.text.match(/https?:\/\/\S+/)?.[0];
    expect(link, mail.text).toBeTruthy();
    expect(mail.html).toContain(link!.replaceAll("&", "&amp;"));
    return new URL(link!);
  }

  function expectSentAsRoBots(mail: CapturedMail, to: string) {
    expect(mail.login).toEqual(smtpLogin);
    expect(mail.envelope).toEqual({ from: "no-reply@tryrobots.app", to: [to] });
    expect(mail.headers.get("from")).toBe(sender);
    expect(mail.headers.get("to")).toBe(to);
  }

  async function follow(link: URL) {
    expect(link.origin).toBe(publicOrigin);
    return handles.app.request(link.pathname + link.search);
  }

  async function register() {
    const email = `account-email-${stamp}-${++accounts}@example.test`;
    const password = "first-password-123";
    const response = await auth("/sign-up/email", { email, password, name: "Ada" });
    expect(response.status, await response.clone().text()).toBe(200);
    return { email, password };
  }

  const emailVerified = (email: string) =>
    runAsSystem("read the account", () =>
      handles.prisma.user.findUniqueOrThrow({ where: { email }, select: { emailVerified: true } }),
    ).then((user) => user.emailVerified);

  it("registers, verifies the address from the emailed link, and signs in", async () => {
    const { email, password } = await register();
    expect(await emailVerified(email)).toBe(false);

    const mail = await mailTo(email, "Verify your RoBots email");
    expectSentAsRoBots(mail, email);
    const link = linkIn(mail);
    expect(link.pathname).toBe("/api/auth/verify-email");
    expect(link.searchParams.get("callbackURL")).toBe(`${publicOrigin}/sign-in`);

    const verified = await follow(link);
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe(`${publicOrigin}/sign-in`);
    expect(await emailVerified(email)).toBe(true);

    const session = await signIn(email, password);
    expect(session.status).toBe(200);
    expect(sessionCookieHeader(session)).toMatch(/session_token=/);
  });

  it("resets a forgotten password from the emailed link before the address was verified", async () => {
    const { email, password } = await register();

    const capabilities = await (await handles.app.request("/api/auth/capabilities")).json();
    expect(capabilities).toMatchObject({
      passwordReset: true,
      resetUrl: `${publicOrigin}/reset-password`,
    });
    const requested = await auth("/request-password-reset", {
      email,
      redirectTo: capabilities.resetUrl,
    });
    expect(requested.status, await requested.clone().text()).toBe(200);

    const mail = await mailTo(email, "Reset your RoBots password");
    expectSentAsRoBots(mail, email);
    const link = linkIn(mail);
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/);
    const token = link.pathname.split("/").at(-1)!;

    const opened = await follow(link);
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(`${publicOrigin}/reset-password?token=${token}`);

    const newPassword = "second-password-456";
    const reset = await auth("/reset-password", { token, newPassword });
    expect(reset.status, await reset.clone().text()).toBe(200);

    expect((await signIn(email, password)).status).toBe(401);
    expect((await signIn(email, newPassword)).status).toBe(200);
  });
});
