import { t } from "@lingui/core/macro";
import type { BotTemplate } from "@robots/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary">;

export function botTemplateCopy(template: BotTemplate): BotTemplateCopy {
  switch (template.id) {
    case "chief-of-staff":
      return {
        name: t`Chief of Staff`,
        summary: t`Takes your requests, hands each one to the right bot and brings you only the decisions that are yours.`,
      };
    case "developer":
      return {
        name: t`Dev`,
        summary: t`Just ask for coding work. Reproduces the bug, writes the fix, runs the tests and asks before it opens a pull request.`,
      };
    case "researcher":
      return {
        name: t`Researcher`,
        summary: t`Works from a research prompt: reads the sources, writes plain-language notes and links a source for every claim.`,
      };
    case "sales":
      return {
        name: t`Sales`,
        summary: t`Gets the money. Follows up on warm leads, keeps the pipeline honest and flags the deals that have gone quiet.`,
      };
    case "gtm":
      return {
        name: t`GTM`,
        summary: t`Takes what you shipped to market: launch posts and outreach drafts. Nothing goes out until you say so.`,
      };
    case "refund-bot":
      return {
        name: t`Refund Bot`,
        summary: t`Checks refund requests against your policy, approves what fits, and asks you before any refund over your limit.`,
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
