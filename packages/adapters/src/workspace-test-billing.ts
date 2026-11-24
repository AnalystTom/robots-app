import type { BillingPrice, BillingProvider } from "@robots/adapter-kit";
import type { StripeBillingConfig } from "./stripe-billing.js";
import { StripeBillingProvider } from "./stripe-billing.js";

export async function createWorkspaceTestBilling(
  config: StripeBillingConfig,
  requiredPrice: BillingPrice,
): Promise<BillingProvider & { billingUnit: "workspace" }> {
  if (
    !/^(sk|rk)_test_/.test(config.secretKey) ||
    !config.webhookSecret.startsWith("whsec_") ||
    !config.priceId
  ) {
    throw new Error(
      "Workspace testing requires a sandbox key, webhook signing secret and monthly price",
    );
  }
  const stripe = new StripeBillingProvider(config);
  const price = await stripe.getPrice();
  if (
    price.amount !== requiredPrice.amount ||
    price.currency !== requiredPrice.currency ||
    price.interval !== requiredPrice.interval ||
    price.intervalCount !== requiredPrice.intervalCount
  ) {
    throw new Error("Sandbox price does not match the workspace plan");
  }
  return {
    billingUnit: "workspace",
    describe: () => ({ ...stripe.describe(), capabilities: { trials: false, portal: true } }),
    getPrice: async () => price,
    createCustomer: (input) => stripe.createCustomer(input),
    createCheckout: ({ customerId, successUrl, cancelUrl }) =>
      stripe.createCheckout({ customerId, successUrl, cancelUrl, seats: 1 }),
    createPortal: (input) => stripe.createPortal(input),
    expireOpenCheckouts: (id) => stripe.expireOpenCheckouts(id),
    cancelCustomerSubscriptions: (id) => stripe.cancelCustomerSubscriptions(id),
    updateSeats: (id) => stripe.updateSeats(id, 1),
    parseWebhook: (body, headers) => stripe.parseWebhook(body, headers),
    getCustomerSubscription: async (id) => {
      const subscription = await stripe.getCustomerSubscription(id);
      return subscription?.priceId === config.priceId ? subscription : null;
    },
  };
}
