const { readdir, access } = require("node:fs/promises");
const path = require("node:path");
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
}

module.exports = (context) => verifyResources(context.packager.getResourcesDir(context.appOutDir));

if (require.main === module)
  verifyResources(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
