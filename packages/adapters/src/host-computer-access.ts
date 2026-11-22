import type { PrismaClient } from "@robots/db";
import {
  deploymentAdminEmails,
  isDeploymentAdmin,
  runAsSystem,
  spaceOwnedByDeploymentAdmins,
} from "@robots/db";

export class HostComputerAccessDeniedError extends Error {
  constructor() {
    super("Local computer access is disabled");
    this.name = "HostComputerAccessDeniedError";
  }
}

export interface HostComputerAccess {
  adminEmails: readonly string[];
  singleAccount: boolean;
}

export function hostComputerAccessFromEnv(
  source: Record<string, string | undefined>,
): HostComputerAccess {
  return {
    adminEmails: deploymentAdminEmails(source.ROBOTS_ADMIN_EMAILS),
    singleAccount: Boolean(source.ROBOTS_DESKTOP_STACK_TOKEN?.trim()),
  };
}

export function hostComputerGate(
  prisma: Pick<PrismaClient, "deploymentSettings" | "computer" | "spaceMember" | "user">,
  access: HostComputerAccess = { adminEmails: [], singleAccount: false },
) {
  async function selection(): Promise<{ since: Date } | null> {
    const settings = await prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { computerHost: true, updatedAt: true },
    });
    return settings?.computerHost === "this-mac" ? { since: settings.updatedAt } : null;
  }

  return {
    async forHome(homeKey: string | undefined): Promise<boolean> {
      if (!(await selection())) return false;
      if (access.singleAccount) return true;
      if (!homeKey) return false;
      const computer = await runAsSystem("find the space that owns a computer", () =>
        prisma.computer.findUnique({ where: { homeKey }, select: { spaceId: true } }),
      );
      return computer
        ? spaceOwnedByDeploymentAdmins(prisma, access.adminEmails, computer.spaceId)
        : false;
    },
    async forUser(userId: string): Promise<Date | null> {
      const selected = await selection();
      if (!selected) return null;
      const admin = await runAsSystem("check whether a deployment admin is asking", () =>
        isDeploymentAdmin(prisma, access.adminEmails, userId),
      );
      return admin ? selected.since : null;
    },
  };
}

export type HostComputerGate = Pick<ReturnType<typeof hostComputerGate>, "forHome" | "forUser">;
