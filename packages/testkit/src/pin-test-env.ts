import { randomUUID } from "node:crypto";
import { afterAll, beforeEach } from "vitest";
import { pinMemoryAuditLog } from "./pin-audit-log.js";
import { pinLocalSecretStore } from "./pin-secret-store.js";

const dom = (
  globalThis as typeof globalThis & {
    jsdom?: { window: { localStorage: unknown } };
  }
).jsdom;

if (dom) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: dom.window.localStorage,
  });
  afterAll(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
}

if (!process.env.VERIFY_PROVIDERS) {
  process.env.ROBOTS_LIVE_MODEL_CATALOG = "off";
  process.env.AGENT_RUNTIME = "scripted";
  process.env.SANDBOX_PROVIDER = "fake";
  process.env.CLOUD_AGENT_PROVIDER = "emulator";
  process.env.MEDIA_GENERATION_PROVIDER = "disabled";
  delete process.env.MEDIA_GENERATION_API_KEY;
  process.env.PAID_SERVICES_PROVIDER = "disabled";
  delete process.env.PAID_SERVICES_API_KEY;
  delete process.env.CURSOR_API_KEY;
  process.env.WAKEUP_DRIVER = "memory";
  delete process.env.COMPOSIO_API_KEY;
  delete process.env.INTEGRATIONS_CATALOG_URL;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_API_KEY;
  delete process.env.SMTP_URL;
  delete process.env.BOT_EMAIL_SMTP_URL;
  pinLocalSecretStore();
  if (!process.env.VERIFY_DATABASE) {
    delete process.env.DATABASE_URL;
    delete process.env.REALTIME_DATABASE_URL;
    beforeEach(pinMemoryAuditLog);
  }
}
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
delete process.env.OTEL_CAPTURE_CONTENT;
delete process.env.AXIOM_TOKEN;
delete process.env.AXIOM_DATASET;
delete process.env.SENTRY_DSN;
delete process.env.SENTRY_BROWSER_DSN;
if (!process.env.VERIFY_LOGGING) {
  process.env.LOG_LEVEL = "off";
}

process.env.ANALYTICS_PROVIDER = "none";

if (process.env.VERIFY_DATABASE) {
  const { createPool, drainUnscopedDatabaseAccess } = await import("@robots/db");
  if (process.env.COPY_TEST_DATABASE) {
    const owner = new URL(process.env.DATABASE_MIGRATION_URL!);
    const template = owner.pathname.slice(1);
    const copy = `${template}_${randomUUID().replaceAll("-", "")}`;
    owner.pathname = "/postgres";
    const admin = createPool(owner.href);
    try {
      await admin.query(`CREATE DATABASE "${copy}" TEMPLATE "${template}"`);
    } finally {
      await admin.end();
    }
    for (const name of ["DATABASE_URL", "DATABASE_MIGRATION_URL", "REALTIME_DATABASE_URL"]) {
      const url = new URL(process.env[name]!);
      url.pathname = `/${copy}`;
      process.env[name] = url.href;
    }
  }
  afterAll(() => {
    const sites = drainUnscopedDatabaseAccess();
    if (sites.length) {
      throw new Error(
        `Database access without a tenant or system context:\n\n${sites.join("\n\n")}`,
      );
    }
  });
}
