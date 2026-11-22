import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { BotTemplate } from "@robots/contracts";

export type BotTemplateCopy = Pick<BotTemplate, "name" | "summary">;

export const BOT_TEMPLATE_COPY: Readonly<
  Record<string, { name: MessageDescriptor; summary: MessageDescriptor }>
> = {
  "morning-briefing": {
    name: msg`Morning briefing`,
    summary: msg`Your day at a glance, every weekday morning`,
  },
  "inbox-triage": {
    name: msg`Inbox triage`,
    summary: msg`Sorts new email and drafts the replies`,
  },
  "pr-reviewer": {
    name: msg`PR reviewer`,
    summary: msg`Reviews pull requests waiting on you`,
  },
  "topic-watch": {
    name: msg`Topic watch`,
    summary: msg`A weekly digest of what changed on topics you follow`,
  },
  "social-poster": {
    name: msg`Social poster`,
    summary: msg`Drafts your posts and schedules them once you approve`,
  },
  "meeting-prep": {
    name: msg`Meeting prep`,
    summary: msg`A short brief before each of today's meetings`,
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
  "channel-catch-up": {
    name: msg`Channel catch-up`,
    summary: msg`Sums up busy channels so you can skip the scroll`,
  },
  "research-assistant": {
    name: msg`Research assistant`,
    summary: msg`Digs into a question and reports back with sources`,
  },
  "meal-planner": {
    name: msg`Meal planner`,
    summary: msg`Plans the week's dinners and the shopping list`,
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
