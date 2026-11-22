import { ORPCError } from "@orpc/server";
import { HostComputerAccessDeniedError } from "@robots/adapters";

export async function refuseUnlessHostAdmin<T>(
  work: Promise<T | undefined> | undefined,
): Promise<T> {
  try {
    const value = await work;
    if (value === undefined) throw new HostComputerAccessDeniedError();
    return value;
  } catch (error) {
    if (error instanceof HostComputerAccessDeniedError)
      throw new ORPCError("FORBIDDEN", { message: error.message });
    if (error instanceof Error) throw new ORPCError("BAD_REQUEST", { message: error.message });
    throw error;
  }
}
