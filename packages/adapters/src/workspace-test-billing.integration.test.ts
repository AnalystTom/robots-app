import { expect, it } from "vitest";
import { StripeEmulator } from "./testing/stripe-emulator.js";
import { createWorkspaceTestBilling } from "./workspace-test-billing.js";

const price = { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 } as const;

it("starts one $20 monthly checkout per workspace and syncs completion and cancellation", async () => {
  const wire = new StripeEmulator();
  const billing = await createWorkspaceTestBilling(
    {
      secretKey: wire.secretKey,
      priceId: wire.priceId,
      webhookSecret: "whsec_fixture",
      fetch: (url, options) =>
        new URL(String(url)).pathname === "/v1/prices/price_fake"
          ? Promise.resolve(
              Response.json({
                unit_amount: 2000,
                currency: "usd",
                recurring: { interval: "month", interval_count: 1 },
              }),
            )
          : wire.fetch(url, options),
    },
    price,
  );
  const { customerId } = await billing.createCustomer({
    email: "owner@example.test",
    organizationId: "workspace",
  });
  await billing.createCheckout({
    customerId,
    seats: 8,
    trialDays: 14,
    successUrl: "https://example.test/return",
    cancelUrl: "https://example.test/cancel",
  });
  expect(wire.sessions[0]?.form["line_items[0][quantity]"]).toBe("1");
  expect(wire.sessions[0]?.form["subscription_data[trial_period_days]"]).toBeUndefined();
  expect(await billing.getCustomerSubscription(customerId)).toBeNull();
  wire.completeCheckout(customerId);
  expect(await billing.getCustomerSubscription(customerId)).toMatchObject({
    priceId: wire.priceId,
    status: "active",
  });
  await billing.cancelCustomerSubscriptions(customerId);
  expect((await billing.getCustomerSubscription(customerId))?.status).not.toBe("active");
});

it("refuses a live key before making a request and refuses a different monthly price", async () => {
  const wire = new StripeEmulator();
  const config = {
    secretKey: wire.secretKey,
    webhookSecret: "whsec_fixture",
    priceId: wire.priceId,
    fetch: wire.fetch,
  };
  await expect(
    createWorkspaceTestBilling({ ...config, secretKey: "sk_live_fixture" }, price),
  ).rejects.toThrow();
  expect(wire.requests).toHaveLength(0);
  await expect(createWorkspaceTestBilling(config, price)).rejects.toThrow("price");
});
