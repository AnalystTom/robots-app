import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { BotTemplate } from "@robots/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary">;

export const BOT_TEMPLATE_COPY: Readonly<
  Record<string, { name: MessageDescriptor; summary: MessageDescriptor }>
> = {
  "chief-of-staff": {
    name: msg`Chief of Staff`,
    summary: msg`Takes your requests, hands each one to the right bot and brings you only the decisions that are yours.`,
  },
  developer: {
    name: msg`Dev`,
    summary: msg`Just ask for coding work. Reproduces the bug, writes the fix, runs the tests and asks before it opens a pull request.`,
  },
  researcher: {
    name: msg`Researcher`,
    summary: msg`Works from a research prompt: reads the sources, writes plain-language notes and links a source for every claim.`,
  },
  sales: {
    name: msg`Sales`,
    summary: msg`Gets the money. Follows up on warm leads, keeps the pipeline honest and flags the deals that have gone quiet.`,
  },
  gtm: {
    name: msg`GTM`,
    summary: msg`Takes what you shipped to market: launch posts and outreach drafts. Nothing goes out until you say so.`,
  },
  "refund-bot": {
    name: msg`Refund Bot`,
    summary: msg`Checks refund requests against your policy, approves what fits, and asks you before any refund over your limit.`,
  },
  "inbox-triage": {
    name: msg`Inbox triage`,
    summary: msg`Sorts new email and drafts the replies`,
  },
  "morning-briefing": {
    name: msg`Morning briefing`,
    summary: msg`Your day at a glance, every weekday morning`,
  },
  "meeting-prep": {
    name: msg`Meeting prep`,
    summary: msg`A short brief before each of today's meetings`,
  },
  "pr-reviewer": {
    name: msg`PR reviewer`,
    summary: msg`Reviews pull requests waiting on you`,
  },
  "issue-triage": {
    name: msg`Issue triage`,
    summary: msg`Sorts new issues and flags the urgent ones`,
  },
  "release-notes": {
    name: msg`Release notes`,
    summary: msg`Turns last week's merged work into notes people read`,
  },
  "weekly-recap": {
    name: msg`Weekly recap`,
    summary: msg`What you got done last week, ready to share`,
  },
  "topic-watch": {
    name: msg`Topic watch`,
    summary: msg`A weekly digest of what changed on topics you follow`,
  },
};

export function useBotTemplateCopy(): (template: BotTemplate) => BotTemplateCopy {
  const { i18n } = useLingui();
  return (template) => {
    const copy = BOT_TEMPLATE_COPY[template.id];
    return copy
      ? { name: i18n._(copy.name), summary: i18n._(copy.summary) }
      : { name: template.name, summary: template.summary };
  };
}
