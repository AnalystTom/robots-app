import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, transform } from "esbuild";
import { serverBuildOptions } from "../../scripts/build-server.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(process.argv[2]);
process.chdir(root);
const programs = [
  ["apps/api/src/index.ts", "apps/api/dist/index.js"],
  ["apps/api/src/cli/migrate-database.ts", "apps/api/dist/cli/migrate-database.js"],
  ["apps/worker/src/index.ts", "apps/worker/dist/index.js"],
  ["apps/worker/src/health-check.ts", "apps/worker/dist/health-check.js"],
  ["apps/web/src/standalone-server.ts", "apps/web/dist-server/index.js"],
  ["infra/sandboxes/supervisor/src/index.ts", "infra/sandboxes/supervisor/dist/index.js"],
];
async function save(file, bytes) {
  const target = path.join(output, "runtime", file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
for (const [source, target] of programs) {
  const result = await build({
    ...serverBuildOptions(path.resolve(source), path.resolve(target)),
    write: false,
    sourcemap: false,
    minify: true,
    keepNames: true,
  });
  await save(target, result.outputFiles[0].contents);
}
const runtime = await build({
  entryPoints: ["packages/page-kit/src/runtime.tsx"],
  write: false,
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  minify: true,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"' },
});
await save("packages/page-kit/runtime.js", runtime.outputFiles[0].contents);
await save(
  "packages/page-kit/package.json",
  JSON.stringify({ name: "@robots/page-kit", exports: { "./runtime": "./runtime.js" } }),
);
const config = await transform(await readFile("packages/db/prisma.config.ts", "utf8"), {
  loader: "ts",
  format: "esm",
  minify: true,
});
await save("packages/db/prisma.config.mjs", config.code);
