import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "@robots/api/app";
import { expect, it } from "vitest";
import { discardBotIntroRun } from "./discard-bot-intro.js";
import { sessionCookieHeader } from "./index.js";

const databaseUrl = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;
const origin = "http://127.0.0.1:5173";
const robot = "robot:red.antenna.aviators.cape.confetti";

it.skipIf(!databaseUrl)(
  "stores a robot pick on an Original account with the robots set",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "robots-bot-avatar-set-"));
    const handles = await createApp({
      databaseUrl: databaseUrl!,
      dataDir,
      maxUploadSizeBytes: 20 * 1024 * 1024,
      maxAttachmentsPerMessage: 8,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      webOrigin: origin,
      authUrl: origin,
    });
    try {
      const signup = await handles.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          email: `bot-avatar-set-${Date.now()}@example.test`,
          password: "test-password-123",
          name: "Avatar set tester",
        }),
      });
      expect(signup.status).toBeLessThan(400);
      const cookie = sessionCookieHeader(signup);
      const call = (procedure: string, json: unknown = {}) =>
        handles.app.request(`/rpc/${procedure}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie },
          body: JSON.stringify({ json }),
        });

      const original = await call("preferences/update", { botAvatarSet: "organic" });
      expect(original.status).toBe(200);

      const created = await call("bots/create", {
        name: "Robot pick",
        title: "",
        description: "",
        instructions: "Keep the look.",
        notifyOnFinish: false,
        color: robot,
        avatarSet: "robots",
      });
      expect(created.status).toBe(200);
      const bot = (
        (await created.json()) as { json: { id: string; color: string; avatarSet: string } }
      ).json;
      await discardBotIntroRun(handles, cookie, bot.id);
      expect(bot).toMatchObject({ color: robot, avatarSet: "robots" });
    } finally {
      await handles.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
