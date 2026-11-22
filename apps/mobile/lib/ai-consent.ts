import { t } from "@lingui/core/macro";
import type { AiDataUse, AiRecipient } from "@robots/contracts";
import { AI_PRIVACY_URL } from "@robots/contracts";
import { bestEffort } from "@robots/logging";
import { useSyncExternalStore } from "react";
import { BackHandler, Platform } from "react-native";

export function aiDataDisclosure(use: AiDataUse): string {
  switch (use) {
    case "model":
      return t`Messages, chat history, bot instructions, memories, attachments, screenshots and connected-app content are sent to run your bots, including routines.`;
    case "voice":
      return t`Your recordings are sent for transcription, and text you play is sent to generate speech.`;
    case "memory":
      return t`Conversations, names, memories, searches and bot and Space IDs are sent to store and recall context.`;
  }
}

export type AiConsentRequest = {
  recipients: AiRecipient[];
  privacyUrl: string;
  denied: boolean;
};

type ConsentGrant = () => Promise<unknown>;
type QueuedRequest = {
  recipients: AiRecipient[];
  privacyUrl: string;
  grant: ConsentGrant;
  decide(allowed: boolean): void;
};
type BlockedRequest = Omit<QueuedRequest, "decide">;

let queue: QueuedRequest[] = [];
let blocked: BlockedRequest | null = null;
let snapshot: AiConsentRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: QueuedRequest[], nextBlocked: BlockedRequest | null = blocked) {
  queue = next;
  blocked = nextBlocked;
  const shown = blocked ?? queue[0];
  snapshot = shown
    ? { recipients: shown.recipients, privacyUrl: shown.privacyUrl, denied: blocked !== null }
    : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentRequest(): AiConsentRequest | null {
  return snapshot;
}

export function promptAiConsent(
  recipients: AiRecipient[],
  privacyUrl = AI_PRIVACY_URL,
  grant: ConsentGrant,
): Promise<boolean> {
  return new Promise((decide) => {
    if (blocked) {
      decide(false);
      return;
    }
    publish([...queue, { recipients, privacyUrl, grant, decide }]);
  });
}

export function useAiConsentRequest(): AiConsentRequest | null {
  return useSyncExternalStore(subscribe, currentRequest, currentRequest);
}

export function approveAiConsent() {
  const [shown, ...rest] = queue;
  if (!shown) return;
  publish(rest);
  shown.decide(true);
}

export function denyAiConsent() {
  const [shown, ...rest] = queue;
  if (!shown) return;
  if (Platform.OS === "android") {
    BackHandler.exitApp();
    return;
  }
  publish([], { recipients: shown.recipients, privacyUrl: shown.privacyUrl, grant: shown.grant });
  shown.decide(false);
  for (const request of rest) request.decide(false);
}

export function reviewAiConsentAgain() {
  if (!blocked) return;
  const { recipients, privacyUrl, grant } = blocked;
  publish(
    [
      {
        recipients,
        privacyUrl,
        grant,
        decide: (allowed) => {
          if (allowed) void bestEffort("grant AI data sharing after review", grant());
        },
      },
    ],
    null,
  );
}
