const { readFile, readdir, access } = require("node:fs/promises");
const path = require("node:path");
const { parse } = require("yaml");
const published = require("../../../infra/local-release/desktop-images.json");
const { listPackage } = require("@electron/asar");

async function verifyResources(resources) {
  const files = listPackage(path.join(resources, "app.asar")).map((file) =>
    file.replaceAll("\\", "/"),
  );
  const web = await readdir(path.join(resources, "web"), { recursive: true });
  const sources = [
    ...files.filter(
      (file) => file.startsWith("/node_modules/@robots/") || /^\/dist\/.*\.(map|tsx?)$/.test(file),
    ),
    ...web.filter((file) => file.endsWith(".map")),
  ];
  if (sources.length) throw new Error(`Installer contains RoBots source: ${sources[0]}`);
  if (!files.includes("/dist/main.js"))
    throw new Error("Installer is missing the desktop entry point");
  await access(path.join(resources, "web", "index.html"));
  const compose = parse(
    await readFile(path.join(resources, "stack", "docker-compose.images.yml"), "utf8"),
    { merge: true, maxAliasCount: 2000 },
  );
  const app = `downloads.tryrobots.app/robots/app@${published.app}`;
  const computer = `downloads.tryrobots.app/robots/computer@${published.computer}`;
  for (const name of ["api", "web", "worker", "migrate", "supervisor", "computer"]) {
    if (compose.services[name]?.image !== (name === "computer" ? computer : app)) {
      throw new Error(`Installer is missing the public runtime for ${name}`);
    }
  }
  if (compose.services.supervisor.environment.ROBOTS_COMPUTER_IMAGE !== computer)
    throw new Error("Supervisor is missing the public computer image");
}

module.exports = (context) => verifyResources(context.packager.getResourcesDir(context.appOutDir));

if (require.main === module)
  verifyResources(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
