import { ORPCError } from "@orpc/server";
import { HostBrowserImportUnavailableError, HostComputerAccessDeniedError } from "@robots/adapters";

export async function refuseUnlessHostAdmin<T>(work: Promise<T> | undefined): Promise<T> {
  const unavailable = new HostBrowserImportUnavailableError().message;
  if (!work) throw new ORPCError("FORBIDDEN", { message: unavailable });
  try {
    return await work;
  } catch (error) {
    if (
      error instanceof HostComputerAccessDeniedError ||
      error instanceof HostBrowserImportUnavailableError
    )
      throw new ORPCError("FORBIDDEN", { message: unavailable });
    if (error instanceof Error) throw new ORPCError("BAD_REQUEST", { message: error.message });
    throw error;
  }
}
