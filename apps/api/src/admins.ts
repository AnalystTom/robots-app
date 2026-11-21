import { ORPCError } from "@orpc/server";
import { isDeploymentAdmin } from "@robots/db";
import type { RouterDeps } from "./router.js";

type AdminDeps = Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> };

export function isAdmin(deps: AdminDeps, userId: string): Promise<boolean> {
  return isDeploymentAdmin(deps.prisma, deps.env.adminEmails ?? [], userId);
}

export async function requireAdmin(deps: AdminDeps, userId: string): Promise<void> {
  if (!(await isAdmin(deps, userId))) throw new ORPCError("FORBIDDEN", { message: "Admins only" });
}
