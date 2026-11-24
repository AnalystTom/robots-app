import type { PrismaClient } from "./client.js";

export type AuditEventDb = Pick<PrismaClient, "auditEvent" | "space" | "user" | "member">;

let store: AuditEventDb | undefined;

export function installAuditEventStore(db: AuditEventDb | undefined): void {
  store = db;
}

export function auditEventStore(): AuditEventDb | undefined {
  return store;
}
