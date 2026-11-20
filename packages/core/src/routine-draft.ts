import type { Routine, RoutineEmailSenders } from "@robots/contracts";
import type { CronPreset } from "./cron.js";
import { defaultCronPreset, presetFromCron } from "./cron.js";

export type RoutineDraft = {
  name: string;
  prompt: string;
  schedules: CronPreset[];
  emailSenders: RoutineEmailSenders | null;
  active: boolean;
};

export function emptyRoutineDraft(): RoutineDraft {
  return {
    name: "",
    prompt: "",
    schedules: [defaultCronPreset()],
    emailSenders: null,
    active: true,
  };
}

export function draftFromRoutine(
  routine: Pick<Routine, "name" | "prompt" | "crons" | "emailSenders" | "active">,
): RoutineDraft {
  return {
    name: routine.name,
    prompt: routine.prompt,
    schedules: routine.crons.map(presetFromCron),
    emailSenders: routine.emailSenders,
    active: routine.active,
  };
}
