import { t } from "@lingui/core/macro";
import type { BotTemplate } from "@robots/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary">;

export function botTemplateCopy(template: BotTemplate): BotTemplateCopy {
  switch (template.id) {
    case "morning-briefing":
      return {
        name: t`Morning briefing`,
        summary: t`Your day at a glance, every weekday morning`,
      };
    case "inbox-triage":
      return { name: t`Inbox triage`, summary: t`Sorts new email and drafts the replies` };
    case "pr-reviewer":
      return { name: t`PR reviewer`, summary: t`Reviews pull requests waiting on you` };
    case "topic-watch":
      return {
        name: t`Topic watch`,
        summary: t`A weekly digest of what changed on topics you follow`,
      };
    case "social-poster":
      return {
        name: t`Social poster`,
        summary: t`Drafts your posts and schedules them once you approve`,
      };
    case "meeting-prep":
      return { name: t`Meeting prep`, summary: t`A short brief before each of today's meetings` };
    case "issue-triage":
      return { name: t`Issue triage`, summary: t`Sorts new issues and flags the urgent ones` };
    case "release-notes":
      return {
        name: t`Release notes`,
        summary: t`Turns last week's merged work into notes people read`,
      };
    case "weekly-recap":
      return { name: t`Weekly recap`, summary: t`What you got done last week, ready to share` };
    case "channel-catch-up":
      return {
        name: t`Channel catch-up`,
        summary: t`Sums up busy channels so you can skip the scroll`,
      };
    case "research-assistant":
      return {
        name: t`Research assistant`,
        summary: t`Digs into a question and reports back with sources`,
      };
    case "meal-planner":
      return { name: t`Meal planner`, summary: t`Plans the week's dinners and the shopping list` };
    default:
      return { name: template.name, summary: template.summary };
  }
}
