import type { BotAvatarSet, BotPackage } from "@robots/contracts";
import {
  BOT_COLORS,
  BOT_PACKAGE_FILE_EXTENSION,
  BOT_PACKAGE_FORMAT,
  BOT_PACKAGE_MAX_LENGTH,
  BOT_PACKAGE_TEXT_MAX_LENGTH,
  BOT_PACKAGE_VERSION,
  BotPackageMemorySchema,
  BotPackageRoutineSchema,
  BotPackageSchema,
  isBotAvatarValue,
} from "@robots/contracts";
import { redactCredentials } from "./agent-import/credentials.js";

export type BotPackageSource = {
  bot: {
    name: string;
    description: string;
    instructions: string;
    color: string;
    avatarSet: BotAvatarSet;
    modelProvider: string | null;
    modelId: string | null;
  };
  skills: readonly { content: string }[];
  routines: readonly {
    name: string;
    prompt: string;
    crons: readonly string[];
    timezone: string;
    webhookEnabled: boolean;
    githubEnabled: boolean;
    messageProvider: string | null;
    emailSenders: string | null;
    watch: unknown;
  }[];
  memory: readonly { path: string; content: string }[];
};

export type BotPackageErrorCode =
  | "not_package"
  | "too_large"
  | "unknown_version"
  | "newer_version"
  | "invalid";

export class BotPackageError extends Error {
  constructor(
    readonly code: BotPackageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotPackageError";
  }
}

export function exportBotPackage(
  source: BotPackageSource,
  options: { includeMemory: boolean; now?: Date },
): BotPackage {
  const clean = redactCredentials;
  const model =
    source.bot.modelProvider && source.bot.modelId
      ? { provider: source.bot.modelProvider, modelId: source.bot.modelId }
      : null;
  const routines = source.routines.filter(isPortableRoutine).flatMap((routine) => {
    const parsed = BotPackageRoutineSchema.safeParse({
      name: clean(routine.name),
      prompt: clean(routine.prompt),
      crons: [...routine.crons],
      timezone: routine.timezone,
    });
    return parsed.success ? [parsed.data] : [];
  });
  const memory = options.includeMemory
    ? source.memory.flatMap((note) => {
        const parsed = BotPackageMemorySchema.safeParse({
          path: note.path,
          content: clean(note.content),
        });
        return parsed.success && parsed.data.content.trim() ? [parsed.data] : [];
      })
    : [];
  return BotPackageSchema.parse({
    format: BOT_PACKAGE_FORMAT,
    version: BOT_PACKAGE_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    bot: {
      name: clean(source.bot.name),
      description: clean(source.bot.description),
      instructions: clean(source.bot.instructions),
      color: isBotAvatarValue(source.bot.color) ? source.bot.color : BOT_COLORS[0],
      avatarSet: source.bot.avatarSet,
      model,
    },
    skills: source.skills
      .map((skill) => ({ content: clean(skill.content) }))
      .filter((skill) => skill.content.length <= BOT_PACKAGE_TEXT_MAX_LENGTH),
    routines,
    memory,
  });
}

export function importBotPackage(text: string): BotPackage {
  if (text.length > BOT_PACKAGE_MAX_LENGTH) {
    throw new BotPackageError("too_large", "This bot package is too large to import.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw notPackage();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw notPackage();
  const fields = raw as Record<string, unknown>;
  if (fields.format !== BOT_PACKAGE_FORMAT) throw notPackage();
  const version = fields.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new BotPackageError(
      "unknown_version",
      `This bot package has an unknown format version (${JSON.stringify(version) ?? "none"}).`,
    );
  }
  if (version > BOT_PACKAGE_VERSION) {
    throw new BotPackageError(
      "newer_version",
      `This bot package uses format version ${version}, but this version of RoBots reads up to version ${BOT_PACKAGE_VERSION}. Update RoBots and try again.`,
    );
  }
  const parsed = BotPackageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "package";
    throw new BotPackageError(
      "invalid",
      `This bot package is not valid: ${where}: ${issue?.message ?? "unreadable"}.`,
    );
  }
  return parsed.data;
}

export function botPackageFileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "bot"}${BOT_PACKAGE_FILE_EXTENSION}`;
}

function isPortableRoutine(routine: BotPackageSource["routines"][number]): boolean {
  return (
    !routine.webhookEnabled &&
    !routine.githubEnabled &&
    !routine.messageProvider &&
    !routine.emailSenders &&
    (routine.watch === null || routine.watch === undefined) &&
    routine.crons.length > 0
  );
}

function notPackage() {
  return new BotPackageError("not_package", "This file is not a RoBots bot package.");
}
