import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

type AdminCandidate = { email: string; emailVerified: boolean };

export function deploymentAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((email) => email.toLowerCase());
}

function listedAndVerified(
  user: AdminCandidate | null | undefined,
  adminEmails: readonly string[],
): boolean {
  return Boolean(user?.emailVerified && adminEmails.includes(user.email.toLowerCase()));
}

export async function isDeploymentAdmin(
  prisma: Pick<PrismaClient, "user">,
  adminEmails: readonly string[],
  userId: string,
): Promise<boolean> {
  if (adminEmails.length === 0) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return listedAndVerified(user, adminEmails);
}

export async function spaceOwnedByDeploymentAdmins(
  prisma: Pick<PrismaClient, "spaceMember" | "user">,
  adminEmails: readonly string[],
  spaceId: string,
): Promise<boolean> {
  if (adminEmails.length === 0) return false;
  return runAsSystem("check that deployment admins own a space", async () => {
    const owners = await prisma.spaceMember.findMany({
      where: { spaceId, role: "owner" },
      select: { userId: true },
    });
    if (owners.length === 0) return false;
    const users = await prisma.user.findMany({
      where: { id: { in: owners.map((owner) => owner.userId) } },
      select: { email: true, emailVerified: true },
    });
    return (
      users.length === owners.length && users.every((user) => listedAndVerified(user, adminEmails))
    );
  });
}
