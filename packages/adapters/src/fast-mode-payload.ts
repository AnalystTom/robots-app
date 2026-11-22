import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { fastModeServiceTier } from "@robots/core";

export function withFastMode<O extends SimpleStreamOptions>(
  model: Pick<Model<Api>, "provider">,
  options: O | undefined,
  fastMode: boolean | undefined,
): O | undefined {
  const serviceTier = fastModeServiceTier(fastMode, model.provider);
  if (!serviceTier) return options;
  const previous = options?.onPayload;
  return {
    ...options,
    async onPayload(payload, requestModel) {
      const replaced = (await previous?.(payload, requestModel)) ?? payload;
      return { ...(replaced as object), service_tier: serviceTier };
    },
  } as O;
}
