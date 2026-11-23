import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  BillingCheckoutRequest,
  BillingProvider,
  BillingSubscriptionSnapshot,
} from "@robots/adapter-kit";
import { BillingCheckoutCompletedError } from "@robots/adapter-kit";

export const hostingPrice = {
  amount: 2000,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
} as const;

export class RegistrationTestBilling implements BillingProvider {
  readonly billingUnit = "workspace";
  private readonly db: DatabaseSync;

  constructor(
    file: string,
    private readonly origin: string,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY, token TEXT UNIQUE, started TEXT, ended TEXT
    )`);
  }

  describe() {
    return {
      id: "registration-test",
      adapterVersion: "1",
      contractVersion: "1",
      capabilities: { trials: false, portal: true },
    };
  }

  async getPrice() {
    return hostingPrice;
  }

  async createCustomer(input: { organizationId: string }) {
    this.db
      .prepare("INSERT INTO workspace (id) VALUES (?) ON CONFLICT DO NOTHING")
      .run(input.organizationId);
    return { customerId: input.organizationId };
  }

  async createCheckout({ customerId }: BillingCheckoutRequest) {
    const token = randomUUID();
    const changed = this.db
      .prepare(
        "UPDATE workspace SET token = ? WHERE id = ? AND (started IS NULL OR ended IS NOT NULL)",
      )
      .run(token, customerId);
    if (!changed.changes) throw new BillingCheckoutCompletedError();
    return { url: new URL(`/api/registration/checkout/${token}`, this.origin).href };
  }

  async createPortal({ customerId }: { customerId: string }) {
    const token = randomUUID();
    this.db.prepare("UPDATE workspace SET token = ? WHERE id = ?").run(token, customerId);
    return { url: new URL(`/api/registration/checkout/${token}`, this.origin).href };
  }

  checkout(owner: string, token: string) {
    const row = this.db
      .prepare(
        "SELECT started IS NOT NULL AND ended IS NULL AS active FROM workspace WHERE id = ? AND token = ?",
      )
      .get(owner, token);
    return row ? { active: !!row.active } : null;
  }

  finish(owner: string, token: string, action: string) {
    const sql =
      action === "subscribe"
        ? "UPDATE workspace SET token = NULL, started = ?, ended = NULL WHERE id = ? AND token = ? AND (started IS NULL OR ended IS NOT NULL)"
        : "UPDATE workspace SET token = NULL, ended = ? WHERE id = ? AND token = ? AND started IS NOT NULL AND ended IS NULL";
    return this.db.prepare(sql).run(new Date().toISOString(), owner, token).changes === 1;
  }

  dismiss(id: string, token: string) {
    this.db.prepare("UPDATE workspace SET token = NULL WHERE id = ? AND token = ?").run(id, token);
  }

  async expireOpenCheckouts(id: string) {
    this.db.prepare("UPDATE workspace SET token = NULL WHERE id = ?").run(id);
  }

  async cancelCustomerSubscriptions(id: string) {
    this.db
      .prepare("UPDATE workspace SET token = NULL, ended = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async getCustomerSubscription(id: string): Promise<BillingSubscriptionSnapshot | null> {
    const row = this.db.prepare("SELECT started, ended FROM workspace WHERE id = ?").get(id);
    if (typeof row?.started !== "string") return null;
    const start = new Date(row.started);
    const end = new Date(start);
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 2, 0);
    end.setUTCDate(Math.min(start.getUTCDate(), end.getUTCDate()));
    return {
      subscriptionId: `test-${id}-${start.getTime()}`,
      subscriptionItemId: id,
      priceId: "hosting-monthly-usd",
      status: row.ended ? "canceled" : "active",
      trialEndsAt: null,
      seats: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStartsAt: start,
      currentPeriodEndsAt: end,
      endedAt: row.ended ? new Date(String(row.ended)) : null,
    };
  }

  async updateSeats() {}
  parseWebhook() {
    return null;
  }
  close() {
    this.db.close();
  }
}
