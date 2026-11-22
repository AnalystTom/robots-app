import { t } from "@lingui/core/macro";
import type { BotTemplate } from "@robots/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary">;

export function botTemplateCopy(template: BotTemplate): BotTemplateCopy {
  switch (template.id) {
    case "chief-of-staff":
      return {
        name: t`Chief of Staff`,
        summary: t`Hands each request to the right bot`,
      };
    case "developer":
      return {
        name: t`Dev`,
        summary: t`Reproduces bugs, writes fixes and runs the tests`,
      };
    case "researcher":
      return {
        name: t`Researcher`,
        summary: t`Reads sources and writes notes that cite each claim`,
      };
    case "sales":
      return {
        name: t`Sales`,
        summary: t`Follows up on warm leads and flags quiet deals`,
      };
    case "gtm":
      return {
        name: t`GTM`,
        summary: t`Drafts launch posts and outreach for your approval`,
      };
    case "refund-bot":
      return {
        name: t`Refund Bot`,
        summary: t`Approves refunds that fit your policy`,
      };
    case "inbox-triage":
      return { name: t`Inbox triage`, summary: t`Sorts new email and drafts the replies` };
    case "morning-briefing":
      return { name: t`Morning briefing`, summary: t`Your day at a glance, every weekday morning` };
    case "meeting-prep":
      return { name: t`Meeting prep`, summary: t`A short brief before each of today's meetings` };
    case "pr-reviewer":
      return { name: t`PR reviewer`, summary: t`Reviews pull requests waiting on you` };
    case "issue-triage":
      return { name: t`Issue triage`, summary: t`Sorts new issues and flags the urgent ones` };
    case "release-notes":
      return {
        name: t`Release notes`,
        summary: t`Turns last week's merged work into notes people read`,
      };
    case "weekly-recap":
      return { name: t`Weekly recap`, summary: t`What you got done last week, ready to share` };
    case "topic-watch":
      return {
        name: t`Topic watch`,
        summary: t`A weekly digest of what changed on topics you follow`,
      };
    default:
      return { name: template.name, summary: template.summary };
  }
}
