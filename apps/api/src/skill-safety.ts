import { ORPCError } from "@orpc/server";
import type { SkillSafetyBlock } from "@robots/contracts";
import { SKILL_SAFETY_BLOCKED_REASON } from "@robots/contracts";
import { unacceptedRiskySkills } from "@robots/core";

export function assertSkillsInstallable(
  skills: readonly { name: string; content: string; acceptRisk: boolean }[],
): void {
  const blocked = unacceptedRiskySkills(skills);
  if (!blocked.length) return;
  const names = blocked.map((skill) => skill.name).join(", ");
  const data: SkillSafetyBlock = { reason: SKILL_SAFETY_BLOCKED_REASON, skills: blocked };
  throw new ORPCError("BAD_REQUEST", {
    message: `Risky content found in ${names}. Review it and choose Install anyway to continue.`,
    data,
  });
}
