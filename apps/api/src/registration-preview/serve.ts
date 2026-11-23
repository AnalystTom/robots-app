import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { organizationForMember, runAsTenant } from "@robots/db";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { checkoutPage, localArchive, localPage, registrationPath, setupPage } from "./pages.js";
import { RegistrationTestBilling } from "./provider.js";

const env = loadEnv();
const origin = "http://localhost:5194";
const database = new URL(env.databaseUrl);
if (
  process.env.ROBOTS_REGISTRATION_MODE !== "private-test" ||
  env.webOrigin !== origin ||
  env.authUrl !== origin ||
  database.hostname !== "registration-db" ||
  database.pathname !== "/registration_preview" ||
  env.stripeSecretKey ||
  env.stripeWebhookSecret ||
  env.stripePriceId
) {
  throw new Error("Registration requires the isolated private-test stack");
}
const archive = join("/downloads", localArchive);
const bytes = statSync(archive).size;
const provider = new RegistrationTestBilling(join(env.dataDir, "test-payments.sqlite"), origin);
const { app, prisma, stop } = await createApp({ ...env, billing: provider });
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

function rpc(request: Request, path: string) {
  const headers = new Headers({ "content-type": "application/json", origin });
  for (const key of ["cookie", "authorization", "x-robots-space-id"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  return app.request(`/rpc/${path}`, { method: "POST", headers, body: '{"json":{}}' });
}

async function checkout(request: Request, token: string) {
  if (request.method !== "GET" && request.method !== "POST")
    return new Response(null, { status: 405 });
  if (request.method === "POST" && request.headers.get("origin") !== origin)
    return new Response(null, { status: 403 });
  const me = await rpc(request, "me");
  if (!me.ok) return new Response(null, { status: 401 });
  const { json: actor } = await me.json();
  const org = await runAsTenant(actor, () => organizationForMember(prisma, actor));
  const state = org?.isOwner && provider.checkout(org.organizationId, token);
  if (!org || !state)
    return new Response("This checkout has closed. Open billing to try again.", { status: 404 });
  if (request.method === "GET") return checkoutPage(state.active);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    return new Response(null, { status: 415 });
  const action = (await request.formData()).get("action");
  if (action === "cancel") {
    provider.dismiss(org.organizationId, token);
    return Response.redirect(`${origin}/app`, 303);
  }
  if (
    (action !== "subscribe" && action !== "end") ||
    !provider.finish(org.organizationId, token, action)
  )
    return new Response(null, { status: 409 });
  const synced = await rpc(request, "billing/refresh");
  if (!synced.ok) return synced;
  return Response.redirect(`${origin}/api/v1/billing/return`, 303);
}

async function handle(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === registrationPath && request.method === "GET") return setupPage();
  if (pathname === `${registrationPath}/local` && request.method === "GET") return localPage();
  if (
    pathname === `${registrationPath}/${localArchive}` &&
    ["HEAD", "GET"].includes(request.method)
  ) {
    return new Response(
      request.method === "HEAD"
        ? null
        : (Readable.toWeb(createReadStream(archive, { signal: request.signal })) as ReadableStream),
      {
        headers: {
          "content-type": "application/gzip",
          "content-length": String(bytes),
          "content-disposition": `attachment; filename="${localArchive}"`,
        },
      },
    );
  }
  const token = /^\/api\/registration\/checkout\/([a-f0-9-]{36})$/.exec(pathname)?.[1];
  if (token) return checkout(request, token);
  if (accountRoutes.has(pathname)) return app.fetch(request);
  const status = await rpc(request, "billing/status");
  if (!status.ok) return status;
  if ((await status.json()).json?.access !== true)
    return Response.json({ error: "A hosted subscription is required" }, { status: 402 });
  return app.fetch(request);
}

const server = serve({ hostname: env.apiHost, port: env.port, fetch: handle });
process.once("SIGTERM", () =>
  server.close(async () => {
    await stop();
    provider.close();
  }),
);
