import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";

const root = path.resolve(import.meta.dirname, "../../..");
const composeDir = path.join(root, "infra/compose");
const releaseDir = path.join(root, "infra/local-release");
const output = process.argv[2] || path.join(root, "apps/desktop/build/stack");
const read = (file) => readFile(file, "utf8");
const registry = "downloads.tryrobots.app/robots";
const manifest = JSON.parse(await read(path.join(releaseDir, "desktop-images.json")));
const compose = parse(await read(path.join(composeDir, "docker-compose.images.yml")), {
  merge: true,
});
const { services } = parse(await read(path.join(releaseDir, "docker-compose.override.yml")));
for (const [name, overrides] of Object.entries(services)) {
  const service = compose.services[name];
  service.command = overrides.command;
  if (overrides.environment) Object.assign(service.environment, overrides.environment);
}
function reference(name) {
  const digest = manifest[name];
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid released ${name} digest`);
  return `${registry}/${name}@${digest}`;
}
for (const service of Object.values(compose.services)) {
  if (!service.image.includes("ghcr.io/analysttom/robots-app/")) continue;
  service.image = reference(service === compose.services.computer ? "computer" : "app");
  service.platform = "linux/amd64";
}
compose.services.supervisor.environment.ROBOTS_COMPUTER_IMAGE = reference("computer");
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "docker-compose.images.yml"),
  stringify(compose, { lineWidth: 0 }),
);
