import { createHash } from "node:crypto";
import type { AiDataUse, AiRecipient } from "@robots/contracts";
import { localBaseUrl } from "./pi-local-provider.js";
import { listPiCatalog } from "./pi-models.js";
import { voiceCatalogEntry } from "./voice-factory.js";

const PRIVACY_URLS: Record<string, string> = {
  cursor: "https://cursor.com/privacy",
  openrouter: "https://openrouter.ai/privacy",
  openai: "https://openai.com/policies/privacy-policy/",
  anthropic: "https://www.anthropic.com/legal/privacy",
  google: "https://policies.google.com/privacy",
  "vercel-ai-gateway": "https://vercel.com/legal/privacy-policy",
  elevenlabs: "https://elevenlabs.io/privacy-policy",
  cartesia: "https://cartesia.ai/legal/privacy",
  "fish-audio": "https://fish.audio/privacy/",
  xai: "https://x.ai/legal/privacy-policy",
  supermemory: "https://supermemory.ai/privacy",
  honcho: "https://app.honcho.dev/privacy",
  hindsight: "https://vectorize.io/privacy",
};

const RECIPIENT_COMPANY: Record<string, string> = {
  "openai-codex": "openai",
};

const GATEWAYS = new Set(["openrouter", "vercel-ai-gateway"]);

export type AiRecipientGrant = Omit<AiRecipient, "allowed"> & { grantKeys: string[] };

export function aiRecipient(input: {
  provider: string;
  use: AiDataUse;
  modelId?: string;
  baseUrl?: string;
}): AiRecipientGrant | null {
  if (input.provider === "scripted") return null;
  const endpoint = input.baseUrl ?? (input.provider === "local" ? localBaseUrl() : undefined);
  const origin = endpoint ? new URL(endpoint).origin : undefined;
  const company = RECIPIENT_COMPANY[input.provider] ?? input.provider;
  const name = recipientName(company, input.use);
  const key = grantKey(input.use, company, endpoint, "");
  return {
    key,
    name: origin ? `${name} (${origin})` : name,
    use: input.use,
    detail: GATEWAYS.has(company) ? "Forwards to model providers" : "",
    privacyUrl: PRIVACY_URLS[company],
    grantKeys: [
      key,
      ...new Set(
        companyProviders(company).flatMap((provider) =>
          [input.modelId, ...catalogModelIds(provider)].flatMap((modelId) =>
            modelId ? [grantKey(input.use, provider, endpoint, modelId)] : [],
          ),
        ),
      ),
    ],
  };
}

function grantKey(use: AiDataUse, provider: string, endpoint: string | undefined, modelId: string) {
  return createHash("sha256")
    .update(JSON.stringify([use, provider, endpoint ?? "", modelId]))
    .digest("hex");
}

function companyProviders(company: string) {
  return [
    company,
    ...Object.entries(RECIPIENT_COMPANY).flatMap(([provider, owner]) =>
      owner === company ? [provider] : [],
    ),
  ];
}

function catalogModelIds(provider: string) {
  return listPiCatalog().flatMap((entry) => (entry.provider === provider ? [entry.id] : []));
}

function recipientName(provider: string, use: AiDataUse) {
  if (use === "voice") return voiceCatalogEntry(provider)?.name ?? provider;
  if (use === "memory") {
    if (provider === "supermemory") return "Supermemory";
    if (provider === "honcho") return "Honcho";
    if (provider === "hindsight") return "Hindsight";
    return provider;
  }
  if (provider === "cursor") return "Cursor";
  if (provider === "t3code") return "T3 Code";
  return listPiCatalog().find((entry) => entry.provider === provider)?.providerName ?? provider;
}
