import type { Routine, RpcInput } from "@robots/contracts";
import type { RoutineDraft } from "@robots/core";
import {
  cronFromPreset,
  draftFromRoutine,
  emptyRoutineDraft,
  isOneShotRoutineCrons,
} from "@robots/core";
import type { RoutineWebTrigger } from "./routine";
import { routineTriggerNames } from "./routine";

export type MobileRoutineDraft = RoutineDraft & Partial<Pick<Routine, RoutineWebTrigger>>;

export function routineWithDraftTriggers(routine: Routine, draft: MobileRoutineDraft): Routine {
  return {
    ...routine,
    ...(draft.webhookEnabled === false ? { webhookEnabled: false } : {}),
    ...(draft.githubEnabled === false ? { githubEnabled: false } : {}),
    ...(draft.messageProvider === null ? { messageProvider: null } : {}),
    ...(draft.watch === null ? { watch: null } : {}),
  };
}

export function routineScheduleLocked(routine: Routine | null): boolean {
  return Boolean(routine && isOneShotRoutineCrons(routine.crons));
}

function sameCrons(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((cron, index) => cron === b[index]);
}

function routineChanges(draft: MobileRoutineDraft, routine: Routine) {
  const crons = draft.schedules.map(cronFromPreset);
  const savedCrons = draftFromRoutine(routine).schedules.map(cronFromPreset);
  return {
    ...(draft.name !== routine.name ? { name: draft.name.trim() } : {}),
    ...(draft.prompt !== routine.prompt ? { prompt: draft.prompt.trim() } : {}),
    ...(!routineScheduleLocked(routine) && !sameCrons(crons, savedCrons) ? { crons } : {}),
    ...(draft.emailSenders !== routine.emailSenders ? { emailSenders: draft.emailSenders } : {}),
    ...(draft.active !== routine.active ? { active: draft.active } : {}),
    ...(draft.webhookEnabled === false && routine.webhookEnabled ? { webhookEnabled: false } : {}),
    ...(draft.githubEnabled === false && routine.githubEnabled ? { githubEnabled: false } : {}),
    ...(draft.messageProvider === null && routine.messageProvider ? { messageProvider: null } : {}),
    ...(draft.watch === null && routine.watch ? { watch: null } : {}),
  };
}

export function routineDraftChanged(draft: MobileRoutineDraft, routine: Routine | null): boolean {
  if (!routine) {
    const defaultCrons = emptyRoutineDraft().schedules.map(cronFromPreset);
    return (
      Boolean(draft.name.trim() || draft.prompt.trim() || draft.emailSenders) ||
      !sameCrons(draft.schedules.map(cronFromPreset), defaultCrons)
    );
  }
  return Object.keys(routineChanges(draft, routine)).length > 0;
}

export type RoutineSaveRequest =
  | { error: "name" | "prompt" | "trigger" }
  | { create: RpcInput<"routines/create"> }
  | { update: RpcInput<"routines/update"> }
  | { unchanged: true };

export function routineSaveRequest(
  draft: MobileRoutineDraft,
  routine: Routine | null,
  botId: string,
  timezone: string,
): RoutineSaveRequest {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  if (!name) return { error: "name" };
  if (!prompt) return { error: "prompt" };
  const crons = draft.schedules.map(cronFromPreset);
  const otherTriggers = routine
    ? routineTriggerNames({ ...routineWithDraftTriggers(routine, draft), emailSenders: null })
        .length > 0
    : false;
  if (!crons.length && !draft.emailSenders && !otherTriggers) return { error: "trigger" };
  if (!routine) {
    return {
      create: {
        botId,
        name,
        prompt,
        crons,
        timezone,
        active: draft.active,
        notify: true,
        ...(draft.emailSenders ? { emailSenders: draft.emailSenders } : {}),
      },
    };
  }
  const update = routineChanges(draft, routine);
  if (!Object.keys(update).length) return { unchanged: true };
  return { update: { routineId: routine.id, ...update } };
}
