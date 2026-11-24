import { createHmac } from "node:crypto";
import { ENVIRONMENT_PATH } from "@robots/contracts";
import type { Hono } from "hono";

/**
 * A stable public id for this deployment, derived from its auth secret so it needs no storage
 * and reveals nothing about the secret. A pairing client reads it before sending a code, so a
 * code typed for one server is never sent to another that answers at the same address.
 */
export function environmentId(authSecret: string): string {
  return createHmac("sha256", authSecret)
    .update("robots:environment-id")
    .digest("hex")
    .slice(0, 32);
}

export function mountEnvironmentRoute(app: Hono, authSecret: string) {
  const id = environmentId(authSecret);
  app.get(ENVIRONMENT_PATH, (c) => c.json({ id }, 200, { "cache-control": "no-store" }));
}
