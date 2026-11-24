import { Container } from "@cloudflare/containers";
import { origin, privateStagingRequest } from "./access.mjs";

const settings = [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "SCREEN_PROXY_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
];

export class HostedWorkspace extends Container {
  defaultPort = 5173;
  sleepAfter = "15m";
  enableInternet = true;
  constructor(ctx, env) {
    super(ctx, env);
    for (const name of settings) {
      if (!env[name]) throw new Error(`Missing hosted workspace setting ${name}`);
    }
    this.envVars = {
      ...Object.fromEntries(settings.map((name) => [name, env[name]])),
      API_URL: origin,
      BETTER_AUTH_URL: origin,
      WEB_ORIGIN: origin,
      ROBOTS_HOST: new URL(origin).hostname,
      NODE_ENV: "production",
      API_HOST: "127.0.0.1",
      DATA_DIR: "/data",
      SIGNUPS_ENABLED: "true",
      SANDBOX_PROVIDER: "none",
      AGENT_RUNTIME: "pi",
      WAKEUP_DRIVER: "graphile",
      OBJECT_STORAGE_REGION: "auto",
      OBJECT_STORAGE_PATH_STYLE: "true",
      CONTENT_ENCRYPTION: "on",
    };
  }
}

export default {
  async fetch(request, env) {
    const forwarded = await privateStagingRequest(request, env);
    if (forwarded instanceof Response) return forwarded;
    return env.WORKSPACE.getByName("stripe-sandbox").fetch(forwarded);
  },
};
