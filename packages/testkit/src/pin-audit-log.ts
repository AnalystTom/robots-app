import { installAuditEventStore } from "@robots/db/audit-store";

export function pinMemoryAuditLog(): void {
  installAuditEventStore({
    auditEvent: {
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
    },
    space: { findUnique: async () => ({ organizationId: "test-organization", name: null }) },
    user: { findUnique: async () => null },
    member: { findUnique: async () => ({ role: "owner" }), findMany: async () => [] },
  } as never);
}
