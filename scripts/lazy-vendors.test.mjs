import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { serverBuildOptions } from "./build-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = [
  "apps/api/src/index.ts",
  "apps/worker/src/index.ts",
  "infra/sandboxes/supervisor/src/index.ts",
  "infra/updater/src/index.ts",
];
const OPTIONAL_VENDORS =
  /^(@aws-sdk\/.+|@daytona\/sdk|@e2b\/desktop|novita-sandbox|@composio\/core|@stripe\/link-sdk|@chat-adapter\/(discord|slack|teams|telegram|whatsapp)|@boatdev\/sdk|@boxd-sh\/sdk|@insforge\/instabox-sdk|chat-adapter-sendblue|@axiomhq\/js|@sentry\/node|@alicloud\/.+|@darabonba\/typescript|@kubernetes\/client-node|@larksuiteoapi\/node-sdk|@photon-ai\/chat-adapter-imessage|mppx|railway|@opentelemetry\/(api|sdk-trace|resources|exporter-.+))$/;
const LAZY_NON_VENDORS = [
  "sharp",
  "@better-auth/scim",
  "postal-mime",
  "mailauth",
  "@prisma/client",
];
const PENDING = ["@chat-adapter/telegram", "@chat-adapter/whatsapp", "@stripe/link-sdk"];

const staticVendors = new Map();
const dynamicPackages = new Set();
for (const entry of ENTRIES) {
  const options = serverBuildOptions(path.join(root, entry), path.join(root, "dist/check.js"));
  const { metafile } = await build({
    ...options,
    absWorkingDir: root,
    write: false,
    sourcemap: false,
    metafile: true,
    logLevel: "silent",
  });
  const found = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const edge of output.imports ?? []) {
      const name = packageName(edge.path);
      if (edge.kind === "dynamic-import" && edge.path.includes("node_modules/")) {
        dynamicPackages.add(name);
      }
      if (edge.kind !== "import-statement" && edge.kind !== "require-call") continue;
      if (OPTIONAL_VENDORS.test(name)) found.add(name);
    }
  }
  staticVendors.set(entry, found);
}

for (const [entry, found] of staticVendors) {
  test(`${entry} loads optional vendor SDKs only through dynamic import()`, () => {
    assert.deepEqual(
      [...found].filter((name) => !PENDING.includes(name)),
      [],
    );
  });
}

test("every pending vendor SDK is still statically imported somewhere", () => {
  const anywhere = new Set();
  for (const found of staticVendors.values()) {
    for (const name of found) anywhere.add(name);
  }
  assert.deepEqual(
    PENDING.filter((name) => !anywhere.has(name)),
    [],
    "Now loaded on demand; remove from PENDING",
  );
});

test("every package loaded on demand is a listed vendor SDK or a known non-vendor", () => {
  assert.deepEqual(
    [...dynamicPackages]
      .filter((name) => !OPTIONAL_VENDORS.test(name) && !LAZY_NON_VENDORS.includes(name))
      .sort(),
    [],
    "Add the SDK to OPTIONAL_VENDORS, or a non-vendor package to LAZY_NON_VENDORS",
  );
  assert.deepEqual(
    LAZY_NON_VENDORS.filter((name) => !dynamicPackages.has(name)),
    [],
    "No longer loaded on demand; remove from LAZY_NON_VENDORS",
  );
});

function packageName(external) {
  if (!external.includes("node_modules/")) return external;
  const [scope, name] = external.split("node_modules/").at(-1).split("/");
  return scope.startsWith("@") ? `${scope}/${name}` : scope;
}
