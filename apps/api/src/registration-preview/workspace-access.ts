import type { Hono } from "hono";
import { BILLING_WEBHOOK_PATH } from "../billing-webhook.js";

const accountRoutes = new Set([
  "/api/auth/capabilities",
  "/api/auth/get-session",
  "/api/auth/sign-up/email",
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/rpc/me",
  "/rpc/billing/status",
  "/rpc/billing/refresh",
  "/rpc/billing/checkout",
  "/rpc/billing/portal",
  "/api/v1/billing/return",
  "/health",
  "/ready",
]);

export function workspaceAccess(app: Hono, origin: string, stripe: boolean) {
  function rpc(request: Request, path: string) {
    const headers = new Headers({ "content-type": "application/json", origin });
    for (const key of ["cookie", "authorization", "x-robots-space-id"]) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
    return app.request(`/rpc/${path}`, { method: "POST", headers, body: '{"json":{}}' });
  }

  async function fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (stripe && pathname === BILLING_WEBHOOK_PATH && request.method === "POST")
      return app.fetch(request);
    if (accountRoutes.has(pathname)) return app.fetch(request);
    const status = await rpc(request, "billing/status");
    if (!status.ok) return status;
    if ((await status.json()).json?.access !== true)
      return Response.json({ error: "A hosted subscription is required" }, { status: 402 });
    return app.fetch(request);
  }
  return { rpc, fetch };
}
