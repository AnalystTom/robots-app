export const CLIENT_BUILD_HEADER = "x-robots-client-build";
export const SERVER_BUILD_HEADER = "x-robots-build";
export const CLIENT_UPDATE_REQUIRED = "CLIENT_UPDATE_REQUIRED";
export const CLIENT_UPDATE_REQUIRED_STATUS = 426;

export const CLIENT_KINDS = ["web", "mobile"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export type MinimumClientBuilds = Partial<Record<ClientKind, string>>;

const BUILD_ID = /^\d{14}$/;

export function buildIdAt(date: Date): string {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

export function isBuildId(value: unknown): value is string {
  return typeof value === "string" && BUILD_ID.test(value);
}

export function compareBuilds(a: unknown, b: unknown): number | null {
  if (!isBuildId(a) || !isBuildId(b)) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatClientBuild(kind: ClientKind, build: string): string {
  return `${kind}/${build}`;
}

export function parseClientBuild(
  header: string | null | undefined,
): { kind: ClientKind; build: string } | null {
  const [kind, build, ...rest] = (header ?? "").trim().split("/");
  if (rest.length || !CLIENT_KINDS.includes(kind as ClientKind) || !isBuildId(build)) return null;
  return { kind: kind as ClientKind, build };
}

export function parseMinimumClientBuilds(value: string | undefined): MinimumClientBuilds {
  const minimums: MinimumClientBuilds = {};
  for (const entry of (value ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [kind, build, ...rest] = trimmed.split("=").map((part) => part.trim());
    if (rest.length || !CLIENT_KINDS.includes(kind as ClientKind) || !isBuildId(build)) {
      throw new Error(
        `Invalid ROBOTS_MIN_CLIENT_BUILD entry "${trimmed}": use web=YYYYMMDDHHMMSS or mobile=YYYYMMDDHHMMSS`,
      );
    }
    minimums[kind as ClientKind] = build;
  }
  return minimums;
}

export function clientUpdateRequired(
  header: string | null | undefined,
  minimums: MinimumClientBuilds,
): boolean {
  const client = parseClientBuild(header);
  if (!client) return false;
  return (compareBuilds(client.build, minimums[client.kind]) ?? 0) < 0;
}

export function isClientUpdateRequiredError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === CLIENT_UPDATE_REQUIRED || status === CLIENT_UPDATE_REQUIRED_STATUS;
}
