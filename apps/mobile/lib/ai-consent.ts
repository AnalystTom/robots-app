import { t } from "@lingui/core/macro";
import type { AiDataUse, AiRecipient } from "@robots/contracts";
import { AI_PRIVACY_URL } from "@robots/contracts";
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

type QueuedRequest = Omit<AiConsentRequest, "denied"> & { decide(allowed: boolean): void };

let queue: QueuedRequest[] = [];
let snapshot: AiConsentRequest | null = null;
let blocked: AiConsentRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: QueuedRequest[], nextBlocked: AiConsentRequest | null = blocked) {
  queue = next;
  blocked = nextBlocked;
  const [shown] = queue;
  snapshot =
    blocked ??
    (shown ? { recipients: shown.recipients, privacyUrl: shown.privacyUrl, denied: false } : null);
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
): Promise<boolean> {
  return new Promise((decide) => {
    publish([...queue, { recipients, privacyUrl, decide }]);
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
  publish(rest, { recipients: shown.recipients, privacyUrl: shown.privacyUrl, denied: true });
  shown.decide(false);
}

export function reviewAiConsentAgain() {
  publish(queue, null);
}
