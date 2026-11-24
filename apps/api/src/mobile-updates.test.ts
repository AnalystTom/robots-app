import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MOBILE_UPDATES_PATH, mobileUpdateRoutes, publishMobileUpdate } from "./mobile-updates.js";

const origin = "https://robots.example";
let root: string;
let scratch: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "robots-mobile-updates-"));
  scratch = await mkdtemp(join(tmpdir(), "robots-mobile-export-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

async function fakeExport(name: string, bundle: string) {
  const directory = join(scratch, name);
  await mkdir(join(directory, "_expo/static/js/android"), { recursive: true });
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "_expo/static/js/android/index-1.hbc"), bundle);
  await writeFile(join(directory, "assets/icon0"), "png-bytes");
  await writeFile(
    join(directory, "metadata.json"),
    JSON.stringify({
      version: 0,
      bundler: "metro",
      fileMetadata: {
        android: {
          bundle: "_expo/static/js/android/index-1.hbc",
          assets: [{ path: "assets/icon0", ext: "png" }],
        },
      },
    }),
  );
  return directory;
}

const manifestRequest = (runtimeVersion: string) =>
  new Request(`http://api${MOBILE_UPDATES_PATH}/manifest`, {
    headers: {
      "expo-platform": "android",
      "expo-runtime-version": runtimeVersion,
      accept: "multipart/mixed,application/expo+json,application/json",
    },
  });

const sha256 = (text: string) => createHash("sha256").update(text).digest("base64url");

it("serves the latest published update as an Expo manifest whose files match their hashes", async () => {
  const app = mobileUpdateRoutes(root, () => origin);

  const none = await app.request(manifestRequest("1.0.14"));
  expect(none.status).toBe(204);
  expect(none.headers.get("expo-protocol-version")).toBe("1");

  const first = await publishMobileUpdate({
    root,
    platform: "android",
    runtimeVersion: "1.0.14",
    exportDirectory: await fakeExport("first", "bundle-one"),
    now: new Date("2026-11-22T10:00:00Z"),
  });
  const response = await app.request(manifestRequest("1.0.14"));
  expect(response.status).toBe(200);
  expect(response.headers.get("expo-protocol-version")).toBe("1");
  expect(response.headers.get("expo-sfv-version")).toBe("0");
  const manifest = (await response.json()) as {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: { hash: string; url: string; contentType: string };
    assets: { hash: string; url: string; contentType: string; fileExtension: string }[];
  };
  expect(manifest).toMatchObject({
    id: first.id,
    createdAt: "2026-11-22T10:00:00.000Z",
    runtimeVersion: "1.0.14",
    launchAsset: { hash: sha256("bundle-one"), contentType: "application/javascript" },
    assets: [{ hash: sha256("png-bytes"), contentType: "image/png", fileExtension: ".png" }],
  });
  expect(manifest.launchAsset.url.startsWith(`${origin}${MOBILE_UPDATES_PATH}/assets/`)).toBe(true);

  const bundle = await app.request(manifest.launchAsset.url.replace(origin, "http://api"));
  expect(bundle.status).toBe(200);
  expect(sha256(await bundle.text())).toBe(manifest.launchAsset.hash);
  const icon = await app.request(manifest.assets[0]!.url.replace(origin, "http://api"));
  expect(icon.headers.get("content-type")).toBe("image/png");

  const second = await publishMobileUpdate({
    root,
    platform: "android",
    runtimeVersion: "1.0.14",
    exportDirectory: await fakeExport("second", "bundle-two"),
    now: new Date("2026-11-22T11:00:00Z"),
  });
  const next = (await (await app.request(manifestRequest("1.0.14"))).json()) as {
    id: string;
    launchAsset: { hash: string };
  };
  expect(next.id).toBe(second.id);
  expect(next.launchAsset.hash).toBe(sha256("bundle-two"));

  expect((await app.request(manifestRequest("1.0.13"))).status).toBe(204);
});

it("keeps the three newest updates and refuses paths outside an update", async () => {
  const app = mobileUpdateRoutes(root, () => origin);
  const ids: string[] = [];
  for (const hour of [1, 2, 3, 4]) {
    const update = await publishMobileUpdate({
      root,
      platform: "android",
      runtimeVersion: "1.0.14",
      exportDirectory: await fakeExport(`build-${hour}`, `bundle-${hour}`),
      now: new Date(`2026-11-22T0${hour}:00:00Z`),
    });
    ids.push(update.id);
  }
  const kept = (await readdir(join(root, "android/1.0.14"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(kept).toEqual(ids.slice(1).sort());

  const traversal = await app.request(
    `http://api${MOBILE_UPDATES_PATH}/assets/android/1.0.14/${ids[3]}/..%2F..%2F..%2Fcurrent.json`,
  );
  expect(traversal.status).toBe(404);
  const missingHeaders = await app.request(`http://api${MOBILE_UPDATES_PATH}/manifest`);
  expect(missingHeaders.status).toBe(400);
});
