export const message =
  'The mobile bundle cannot load the @robots/logging root: it pulls node:async_hooks, which Metro cannot bundle. Import a bundle-safe subpath such as "@robots/logging/monitoring", or use bestEffort from apps/mobile/lib/best-effort.ts.';

export const include = ["apps/mobile/**/*.{ts,tsx,js,mjs}"];

export const exclude = ["**/*.{test,spec}.*", "**/e2e/**", "apps/mobile/node_modules/**"];

export const pattern = /(?:from|import\s*\(|require\s*\()\s*["']@robots\/logging["']/g;
