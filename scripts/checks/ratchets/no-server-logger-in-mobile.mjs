export const message =
  "Do not import the root of @robots/logging in apps/mobile: it pulls in Node modules Metro cannot bundle, so the release bundle fails. Use @robots/logging/monitoring or @robots/logging/best-effort.";

export const include = ["apps/mobile/**/*.{ts,tsx}"];

export const exclude = ["**/node_modules/**"];

export const pattern =
  /from\s+["']@robots\/logging["']|import\s*\(\s*["']@robots\/logging["']\s*\)/g;
