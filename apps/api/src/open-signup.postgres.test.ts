import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSandboxProvider, hostComputerGate } from "@robots/adapters";
import { runAsSystem } from "@robots/db";
import { expect, it } from "vitest";
import { discardBotIntroRun } from "../../../packages/testkit/src/discard-bot-intro.js";
import { sessionCookieHeader } from "../../../packages/testkit/src/index.js";
import { createApp } from "./app.js";
import type { AppEnv } from "./env.js";

const databaseUrl = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;
const origin = "http://127.0.0.1:5173";
const stamp = Date.now();
const password = "test-password-123";

async function withApp<T>(
  env: Partial<AppEnv>,
  run: (handles: Awaited<ReturnType<typeof createApp>>) => Promise<T>,
  { keepTesters = false } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "robots-open-signup-"));
  const handles = await createApp({
    databaseUrl: databaseUrl!,
    dataDir,
    sandboxProvider: "fake",
    sandbox: new FakeSandboxProvider(),
    agentRuntime: "scripted",
    wakeupDriver: "memory",
    signupsEnabled: "true",
    signupAllowlist: "",
    webOrigin: origin,
    authUrl: origin,
    ...env,
  });
  try {
    return await run(handles);
  } finally {
    if (!keepTesters)
      await runAsSystem("remove the open signup testers", () =>
        handles.prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } }),
      );
    await handles.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}

type Handles = Awaited<ReturnType<typeof createApp>>;

function post(handles: Handles, path: string, body: unknown, cookie?: string) {
  return handles.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function signUp(handles: Handles, email: string) {
  const response = await post(handles, "/api/auth/sign-up/email", { email, password, name: "P" });
  expect(response.status, await response.clone().text()).toBe(200);
  return sessionCookieHeader(response);
}

async function botHome(handles: Handles, cookie: string) {
  const created = await post(handles, "/rpc/bots/create", { json: { name: "Helper" } }, cookie);
  expect(created.status).toBe(200);
  const botId = ((await created.json()) as { json: { id: string } }).json.id;
  await discardBotIntroRun(handles, cookie, botId);
  const bot = await runAsSystem("read the test bot's computer", () =>
    handles.prisma.bot.findUniqueOrThrow({
      where: { id: botId },
      select: { computer: { select: { homeKey: true } } },
    }),
  );
  return bot.computer!.homeKey;
}

it.skipIf(!databaseUrl)(
  "reports email signup off, refuses it, and keeps existing password accounts signing in",
  async () => {
    const existing = `open-signup-existing-${stamp}@example.test`;
    await withApp(
      {},
      async (handles) => {
        const capabilities = await (await handles.app.request("/api/auth/capabilities")).json();
        expect(capabilities).toMatchObject({ passwordAuth: true, emailSignup: true });
        await signUp(handles, existing);
      },
      { keepTesters: true },
    );
    await withApp({ emailSignup: false }, async (handles) => {
      const capabilities = await (await handles.app.request("/api/auth/capabilities")).json();
      expect(capabilities).toMatchObject({ passwordAuth: true, emailSignup: false });

      const refused = await post(handles, "/api/auth/sign-up/email", {
        email: `open-signup-new-${stamp}@example.test`,
        password,
        name: "New",
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "REGISTRATION_CLOSED" });
      expect(
        await runAsSystem("count refused signups", () =>
          handles.prisma.user.count({ where: { email: `open-signup-new-${stamp}@example.test` } }),
        ),
      ).toBe(0);

      const signIn = await post(handles, "/api/auth/sign-in/email", { email: existing, password });
      expect(signIn.status).toBe(200);
      const me = await post(handles, "/rpc/me", { json: {} }, sessionCookieHeader(signIn));
      expect(me.status).toBe(200);
    });
  },
);

it.skipIf(!databaseUrl)(
  "gives this computer only to bots in spaces a verified deployment admin owns",
  async () => {
    const adminEmail = `host-admin-${stamp}@example.test`;
    const memberEmail = `host-member-${stamp}@example.test`;
    await withApp({ adminEmails: [adminEmail] }, async (handles) => {
      const adminHome = await botHome(handles, await signUp(handles, adminEmail));
      const memberHome = await botHome(handles, await signUp(handles, memberEmail));
      const gate = hostComputerGate(handles.prisma, {
        adminEmails: [adminEmail],
        singleAccount: false,
      });
      const previous = await runAsSystem("read the host choice", () =>
        handles.prisma.deploymentSettings.findUnique({
          where: { id: "default" },
          select: { computerHost: true },
        }),
      );
      const choose = (computerHost: string | null) =>
        runAsSystem("choose the host computer", () =>
          handles.prisma.deploymentSettings.update({
            where: { id: "default" },
            data: { computerHost },
          }),
        );
      try {
        await choose("this-mac");
        expect(await gate.forHome(adminHome)).toBe(false);
        await runAsSystem("verify the admin's email", () =>
          handles.prisma.user.update({
            where: { email: adminEmail },
            data: { emailVerified: true },
          }),
        );
        await runAsSystem("verify the member's email", () =>
          handles.prisma.user.update({
            where: { email: memberEmail },
            data: { emailVerified: true },
          }),
        );
        expect(await gate.forHome(adminHome)).toBe(true);
        expect(await gate.forHome(memberHome)).toBe(false);
        const admin = await runAsSystem("find the admin", () =>
          handles.prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }),
        );
        const member = await runAsSystem("find the member", () =>
          handles.prisma.user.findUniqueOrThrow({ where: { email: memberEmail } }),
        );
        expect(await gate.forUser(admin.id)).toBeInstanceOf(Date);
        expect(await gate.forUser(member.id)).toBeNull();
        await choose("docker");
        expect(await gate.forHome(adminHome)).toBe(false);
      } finally {
        await choose(previous?.computerHost ?? null);
      }
    });
  },
);
