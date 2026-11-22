import { parseRobotCharacter } from "@robots/contracts";
import {
  newClientId,
  ORGANIC_AVATAR_HEART_FAMILY,
  organicAvatarFamily,
  organicAvatarLook,
  ROBOT_PRESETS,
  robotPresetValue,
} from "@robots/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

describePostgres("new bot avatars (PostgreSQL)", () => {
  const provider = "sendblue";
  const address = `+1554${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };

  const actor = () => ({
    userId: owner.userId,
    spaceId: owner.spaceId,
    email: "avatars@example.com",
    isDeploymentOwner: false,
  });
  const botInput = (name: string) => ({
    name,
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider, address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
  });

  afterAll(async () => {
    if (prisma && owner) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({ where: { provider, address } });
      await system.organization.deleteMany({ where: { id: owner.spaceId } });
      await system.user.deleteMany({ where: { id: owner.userId } });
    }
    await close?.();
  });

  it("gives each new bot the ready-made robot the user's other bots wear least", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    const before = await system.bot.findMany({
      where: { spaceId: owner.spaceId, userId: owner.userId },
      select: { id: true, color: true },
    });

    const created = await runAsTenant(owner, async () => {
      const bots = [];
      for (let index = 0; index < 9; index++) {
        bots.push(
          await repos.createBot(actor(), { ...botInput(`Helper ${index}`), avatarSet: "organic" }),
        );
      }
      bots.push(
        await repos.createBot(actor(), {
          ...botInput("Child"),
          avatarSet: "organic",
          parentBotId: bots[0]!.id,
        }),
      );
      return bots;
    });

    const all = [...before, ...created];
    expect(
      created.every((bot) => organicAvatarFamily(bot.id) !== ORGANIC_AVATAR_HEART_FAMILY),
    ).toBe(true);
    const offered = ROBOT_PRESETS.map((preset) => robotPresetValue(preset.id));
    expect(created.every((bot) => offered.includes(bot.color))).toBe(true);
    const firstRobots = all
      .filter((bot) => offered.includes(bot.color))
      .slice(0, ROBOT_PRESETS.length)
      .map((bot) => bot.color);
    expect(new Set(firstRobots).size).toBe(firstRobots.length);
    expect(created.every((bot) => /^c[a-z0-9]{24}$/.test(bot.id))).toBe(true);

    const after = await system.bot.findMany({
      where: { id: { in: before.map((bot) => bot.id) } },
      select: { id: true, color: true },
    });
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it("gives a RoBots bot created without a look the listed robot no other bot wears", async () => {
    const repos = createRepos(prisma);
    await asSystem(prisma).bot.updateMany({
      where: { spaceId: owner.spaceId, userId: owner.userId },
      data: { archivedAt: new Date() },
    });
    await runAsTenant(owner, async () => {
      for (const preset of ROBOT_PRESETS.filter((candidate) => candidate.id !== "hero")) {
        await repos.createBot(actor(), {
          ...botInput(`Worn ${preset.id}`),
          avatarSet: "robots",
          color: robotPresetValue(preset.id),
        });
      }
    });
    const created = await runAsTenant(owner, () =>
      repos.createBot(actor(), { ...botInput("Unpicked"), avatarSet: "robots" }),
    );
    expect(created.color).toBe("robot:red.antenna.aviators.cape.confetti");
  });

  it("defaults a new account's bots to RoBots, keeps an Original account on Original, and reloads explicit sets without altering photos or shapes", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    expect(
      (await system.user.findUniqueOrThrow({ where: { id: owner.userId } })).botAvatarSet,
    ).toBe("robots");
    const created = await runAsTenant(owner, () =>
      repos.createBot(actor(), botInput("RoBots default")),
    );
    expect(created).toMatchObject({ avatarSet: "robots" });
    expect(parseRobotCharacter(created.color)).not.toBeNull();
    await system.user.update({ where: { id: owner.userId }, data: { botAvatarSet: "organic" } });
    const keptOriginal = await runAsTenant(owner, () =>
      repos.createBot(actor(), botInput("Original account")),
    );
    expect(keptOriginal).toMatchObject({ avatarSet: "organic" });
    expect(parseRobotCharacter(keptOriginal.color)).not.toBeNull();
    await system.user.update({ where: { id: owner.userId }, data: { botAvatarSet: "robots" } });
    for (const color of ["#8B5CF6", "#8B5CF6::shape_3", "data:image/png;base64,aGVsbG8="]) {
      const original = await runAsTenant(owner, () =>
        repos.createBot(actor(), { ...botInput("Original look"), avatarSet: "organic", color }),
      );
      expect(original).toMatchObject({ avatarSet: "organic", color });
      await asSystem(prisma).bot.update({
        where: { id: original.id },
        data: { avatarSet: "robots" },
      });
      const reloaded = await runAsTenant(owner, () => repos.listBots(actor()));
      expect(reloaded.find((bot) => bot.id === original.id)).toMatchObject({
        avatarSet: "robots",
        color,
      });
    }
  });

  it("persists the preview seed and colour through a lost response and retry", async () => {
    const repos = createRepos(prisma);
    for (const explicit of [undefined, "#123456"]) {
      const id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
      const input = { ...botInput("Preview"), id, avatarSet: "robots" as const, color: explicit };
      const [first, retry] = await runAsTenant(owner, () =>
        Promise.all([repos.createBot(actor(), input), repos.createBot(actor(), input)]),
      );
      expect(first.id).toBe(id);
      if (explicit) expect(first.color).toBe(explicit);
      else expect(parseRobotCharacter(first.color)).not.toBeNull();
      expect(retry).toMatchObject({ id: first.id, color: first.color, threadId: first.threadId });
      expect(await runAsTenant(owner, () => repos.getBot(actor(), id))).toMatchObject({
        id,
        color: first.color,
      });
      const system = asSystem(prisma);
      expect(await system.thread.count({ where: { botId: id } })).toBe(1);
      await system.bot.update({ where: { id }, data: { archivedAt: new Date() } });
      await expect(runAsTenant(owner, () => repos.createBot(actor(), input))).rejects.toThrow();
      expect(await system.bot.findUnique({ where: { id } })).toMatchObject({
        color: first.color,
        spawnKey: id,
        archivedAt: expect.any(Date),
      });
    }
  });

  it("rejects identity collisions instead of changing or returning another bot", async () => {
    const repos = createRepos(prisma);
    const id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
    const original = await runAsTenant(owner, () =>
      repos.createBot(actor(), {
        ...botInput("Keep me"),
        id,
        spawnKey: "different-key",
        color: "#123456",
      }),
    );
    await expect(
      runAsTenant(owner, () =>
        repos.createBot(actor(), {
          ...botInput("Collision"),
          id,
          color: "#654321",
        }),
      ),
    ).rejects.toThrow();
    const otherAddress = `${address}1`;
    const other = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider, address: otherAddress },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    try {
      await expect(
        runAsTenant(other, () =>
          repos.createBot(
            { ...actor(), ...other },
            {
              ...botInput("Foreign collision"),
              id,
              spawnKey: "different-key",
            },
          ),
        ),
      ).rejects.toThrow();
      expect(await runAsTenant(owner, () => repos.getBot(actor(), id))).toMatchObject({
        id: original.id,
        name: "Keep me",
        color: "#123456",
      });
    } finally {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({ where: { provider, address: otherAddress } });
      await system.organization.deleteMany({ where: { id: other.spaceId } });
      await system.user.deleteMany({ where: { id: other.userId } });
    }
  });

  it("serializes concurrent creation before reading the existing robots", async () => {
    const repos = createRepos(prisma);
    await asSystem(prisma).bot.updateMany({
      where: { spaceId: owner.spaceId, userId: owner.userId },
      data: { archivedAt: new Date() },
    });
    const created = await runAsTenant(owner, () =>
      Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          repos.createBot(actor(), { ...botInput(`Concurrent ${index}`), avatarSet: "organic" }),
        ),
      ),
    );
    expect(new Set(created.map((bot) => bot.color)).size).toBe(8);
    expect(
      created.every((bot) => organicAvatarFamily(bot.id) !== ORGANIC_AVATAR_HEART_FAMILY),
    ).toBe(true);
  });

  it("keeps a colour the caller chose and skips archived bots", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    const live = await system.bot.findMany({
      where: { spaceId: owner.spaceId, userId: owner.userId, archivedAt: null },
      select: { id: true },
    });
    const [kept, ...rest] = live;
    await system.bot.updateMany({
      where: { id: { in: rest.map((bot) => bot.id) } },
      data: { archivedAt: new Date() },
    });
    const next = await runAsTenant(owner, () =>
      repos.createBot(actor(), { ...botInput("Picked"), avatarSet: "organic", color: "#123456" }),
    );
    expect(next.color).toBe("#123456");
    expect(organicAvatarLook(organicAvatarFamily(next.id))).not.toBe(
      organicAvatarLook(organicAvatarFamily(kept!.id)),
    );
  });
});
