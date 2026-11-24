import { serve } from "@hono/node-server";
import { createWorkspaceTestBilling } from "@robots/adapters/workspace-test-billing";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { hostingPrice } from "./provider.js";
import { workspaceAccess } from "./workspace-access.js";

const origin = "https://hosted-test.tryrobots.app";
const env = loadEnv();
const database = new URL(env.databaseUrl);
if (
  env.webOrigin !== origin ||
  env.authUrl !== origin ||
  env.apiHost !== "127.0.0.1" ||
  env.apiUrl !== origin ||
  database.pathname !== "/robots_hosted_test" ||
  !["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode") ?? "") ||
  !process.env.OBJECT_STORAGE_BUCKET ||
  process.env.CONTENT_ENCRYPTION !== "on"
)
  throw new Error(
    "Hosted testing requires its private origin, encrypted storage and dedicated TLS database",
  );
const billing = await createWorkspaceTestBilling(
  {
    secretKey: env.stripeSecretKey ?? "",
    webhookSecret: env.stripeWebhookSecret ?? "",
    priceId: env.stripePriceId,
  },
  hostingPrice,
);
const { app, stop } = await createApp({ ...env, billing });
const access = workspaceAccess(app, origin, true);
const server = serve({ fetch: access.fetch, hostname: env.apiHost, port: env.port });
process.once("SIGTERM", () => server.close(() => void stop()));
