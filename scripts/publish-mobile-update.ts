import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { MobileUpdatePlatform } from "../apps/api/src/mobile-updates.ts";
import { MOBILE_UPDATE_PLATFORMS, publishMobileUpdate } from "../apps/api/src/mobile-updates.ts";

const { values } = parseArgs({
  options: {
    "data-dir": { type: "string" },
    platform: { type: "string", default: "android" },
  },
});
const dataDir = values["data-dir"];
const platform = values.platform as MobileUpdatePlatform;
if (!dataDir) throw new Error("Pass --data-dir with the API data directory");
if (!MOBILE_UPDATE_PLATFORMS.includes(platform)) throw new Error(`Unknown platform ${platform}`);
if (!process.env.EXPO_PUBLIC_API_URL)
  throw new Error("Set EXPO_PUBLIC_API_URL as for the app build");

const repo = join(import.meta.dirname, "..");
const mobile = join(repo, "apps/mobile");
const appJson = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")) as {
  expo: { version: string; runtimeVersion?: { policy?: string } };
};
if (appJson.expo.runtimeVersion?.policy !== "appVersion") {
  throw new Error(
    "Publishing expects the appVersion runtime version policy in apps/mobile/app.json",
  );
}
const exportDirectory = mkdtempSync(join(tmpdir(), "robots-mobile-update-"));
try {
  execFileSync("npx", ["expo", "export", "--platform", platform, "--output-dir", exportDirectory], {
    cwd: mobile,
    stdio: "inherit",
  });
  const update = await publishMobileUpdate({
    root: join(dataDir, "mobile-updates"),
    platform,
    runtimeVersion: appJson.expo.version,
    exportDirectory,
  });
  console.log(`Published ${platform} update ${update.id} for runtime ${appJson.expo.version}`);
} finally {
  rmSync(exportDirectory, { recursive: true, force: true });
}
