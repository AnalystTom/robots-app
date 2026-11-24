import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Hono } from "hono";

export const MOBILE_UPDATES_PATH = "/api/mobile-updates";
export const MOBILE_UPDATE_PLATFORMS = ["android", "ios"] as const;
export type MobileUpdatePlatform = (typeof MOBILE_UPDATE_PLATFORMS)[number];

export type PublishedUpdate = { id: string; createdAt: string };

type ExportMetadata = {
  fileMetadata: Partial<
    Record<MobileUpdatePlatform, { bundle: string; assets: { path: string; ext: string }[] }>
  >;
};

type ManifestAsset = {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
};

const PROTOCOL_HEADERS = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

const CONTENT_TYPES: Record<string, string> = {
  hbc: "application/javascript",
  js: "application/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
};

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function mobileUpdateDirectory(
  root: string,
  platform: MobileUpdatePlatform,
  runtimeVersion: string,
) {
  return join(root, platform, runtimeVersion);
}

const KEPT_UPDATES = 3;

export async function publishMobileUpdate({
  root,
  platform,
  runtimeVersion,
  exportDirectory,
  now = new Date(),
}: {
  root: string;
  platform: MobileUpdatePlatform;
  runtimeVersion: string;
  exportDirectory: string;
  now?: Date;
}): Promise<PublishedUpdate> {
  if (!isSafeSegment(runtimeVersion)) throw new Error(`Unusable runtime version ${runtimeVersion}`);
  const directory = mobileUpdateDirectory(root, platform, runtimeVersion);
  const update: PublishedUpdate = { id: randomUUID(), createdAt: now.toISOString() };
  await mkdir(directory, { recursive: true });
  await cp(exportDirectory, join(directory, update.id), { recursive: true });
  await writeFile(join(directory, update.id, "update.json"), JSON.stringify(update));
  const staged = join(directory, `current.${update.id}.json`);
  await writeFile(staged, JSON.stringify(update));
  await rename(staged, join(directory, "current.json"));
  const published = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        name: entry.name,
        createdAt:
          (await readJson<PublishedUpdate>(join(directory, entry.name, "update.json")))
            ?.createdAt ?? "",
      })),
  );
  const stale = published
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(KEPT_UPDATES);
  await Promise.all(
    stale.map(({ name }) => rm(join(directory, name), { recursive: true, force: true })),
  );
  return update;
}

function isPlatform(value: string | undefined): value is MobileUpdatePlatform {
  return MOBILE_UPDATE_PLATFORMS.includes(value as MobileUpdatePlatform);
}

function isSafeSegment(value: string | undefined): value is string {
  return Boolean(value) && SAFE_SEGMENT.test(value!) && value !== "." && value !== "..";
}

function insideRoot(root: string, path: string) {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(base + sep);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function fileHashes(bytes: Buffer) {
  return {
    hash: createHash("sha256").update(bytes).digest("base64url"),
    key: createHash("md5").update(bytes).digest("hex"),
  };
}

function contentTypeOf(extension: string) {
  return CONTENT_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}

export function mobileUpdateRoutes(root: string, publicOrigin: () => string) {
  const app = new Hono();
  const manifests = new Map<string, unknown>();

  async function manifestFor(platform: MobileUpdatePlatform, runtimeVersion: string) {
    const directory = mobileUpdateDirectory(root, platform, runtimeVersion);
    const current = await readJson<PublishedUpdate>(join(directory, "current.json"));
    if (!current || !isSafeSegment(current.id)) return null;
    const cacheKey = `${platform}/${runtimeVersion}/${current.id}`;
    const cached = manifests.get(cacheKey);
    if (cached) return cached;
    const updateDirectory = join(directory, current.id);
    const metadata = await readJson<ExportMetadata>(join(updateDirectory, "metadata.json"));
    const files = metadata?.fileMetadata[platform];
    if (!files) return null;
    const assetUrl = (path: string) =>
      `${publicOrigin()}${MOBILE_UPDATES_PATH}/assets/${platform}/${encodeURIComponent(runtimeVersion)}/${current.id}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
    const describe = async (path: string, extension: string): Promise<ManifestAsset> => ({
      ...fileHashes(await readFile(join(updateDirectory, path))),
      contentType: contentTypeOf(extension),
      fileExtension: `.${extension}`,
      url: assetUrl(path),
    });
    const launch = await describe(files.bundle, "bundle");
    const manifest = {
      id: current.id,
      createdAt: current.createdAt,
      runtimeVersion,
      launchAsset: {
        hash: launch.hash,
        key: launch.key,
        contentType: "application/javascript",
        url: launch.url,
      },
      assets: await Promise.all(files.assets.map((asset) => describe(asset.path, asset.ext))),
      metadata: {},
      extra: {},
    };
    manifests.set(cacheKey, manifest);
    return manifest;
  }

  app.get(`${MOBILE_UPDATES_PATH}/manifest`, async (c) => {
    const platform = c.req.header("expo-platform") ?? c.req.query("platform");
    const runtimeVersion = c.req.header("expo-runtime-version") ?? c.req.query("runtime-version");
    if (!isPlatform(platform) || !isSafeSegment(runtimeVersion)) {
      return c.json({ error: "expo-platform and expo-runtime-version are required" }, 400);
    }
    const manifest = await manifestFor(platform, runtimeVersion);
    if (!manifest) return c.body(null, 204, PROTOCOL_HEADERS);
    return c.json(manifest, 200, PROTOCOL_HEADERS);
  });

  app.get(`${MOBILE_UPDATES_PATH}/assets/:platform/:runtime/:update/*`, async (c) => {
    const { platform, runtime, update } = c.req.param();
    const prefix = `${MOBILE_UPDATES_PATH}/assets/${platform}/${runtime}/${update}/`;
    const relative = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
    if (!isPlatform(platform) || !isSafeSegment(runtime) || !isSafeSegment(update)) {
      return c.body(null, 404);
    }
    const updateDirectory = join(mobileUpdateDirectory(root, platform, runtime), update);
    const path = join(updateDirectory, relative);
    if (!relative || !insideRoot(updateDirectory, path)) return c.body(null, 404);
    const metadata = await readJson<ExportMetadata>(join(updateDirectory, "metadata.json"));
    const listed = metadata?.fileMetadata[platform]?.assets.find(
      (asset) => asset.path === relative,
    );
    try {
      const bytes = await readFile(path);
      return c.body(bytes, 200, {
        "content-type": contentTypeOf(listed?.ext ?? extname(path).slice(1)),
        "cache-control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.body(null, 404);
    }
  });

  return app;
}
