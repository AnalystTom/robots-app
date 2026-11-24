import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { createWorkspaceTestBilling } from "@robots/adapters/workspace-test-billing";
import { organizationForMember, runAsTenant } from "@robots/db";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { checkoutPage, localArchive, localPage, registrationPath, setupPage } from "./pages.js";
import { hostingPrice, RegistrationTestBilling } from "./provider.js";
import { workspaceAccess } from "./workspace-access.js";

const env = loadEnv();
const mode = process.env.ROBOTS_REGISTRATION_MODE;
const sandbox = mode === "stripe-test";
const origin = sandbox ? "http://localhost:5195" : "http://localhost:5194";
const database = new URL(env.databaseUrl);
if (
  (!sandbox && mode !== "private-test") ||
  env.webOrigin !== origin ||
  env.authUrl !== origin ||
  database.hostname !== "registration-db" ||
  database.pathname !== (sandbox ? "/registration_stripe" : "/registration_preview") ||
  (!sandbox && (env.stripeSecretKey || env.stripeWebhookSecret || env.stripePriceId))
) {
  throw new Error("Registration requires its isolated test stack");
}
const archive = join("/downloads", localArchive);
const bytes = statSync(archive).size;
const simulator = sandbox
  ? undefined
  : new RegistrationTestBilling(join(env.dataDir, "test-payments.sqlite"), origin);
const provider =
  simulator ??
  (await createWorkspaceTestBilling(
    {
      secretKey: env.stripeSecretKey ?? "",
      webhookSecret: env.stripeWebhookSecret ?? "",
      priceId: env.stripePriceId,
    },
    hostingPrice,
  ));
const { app, prisma, stop } = await createApp({ ...env, billing: provider });
const access = workspaceAccess(app, origin, sandbox);

async function checkout(request: Request, token: string, provider: RegistrationTestBilling) {
  if (request.method !== "GET" && request.method !== "POST")
    return new Response(null, { status: 405 });
  if (request.method === "POST" && request.headers.get("origin") !== origin)
    return new Response(null, { status: 403 });
  const me = await access.rpc(request, "me");
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
  const synced = await access.rpc(request, "billing/refresh");
  if (!synced.ok) return synced;
  return Response.redirect(`${origin}/api/v1/billing/return`, 303);
}

async function handle(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === registrationPath && request.method === "GET") return setupPage(sandbox);
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
  if (token && simulator) return checkout(request, token, simulator);
  return access.fetch(request);
}

const server = serve({ hostname: env.apiHost, port: env.port, fetch: handle });
process.once("SIGTERM", () =>
  server.close(async () => {
    await stop();
    simulator?.close();
  }),
);
