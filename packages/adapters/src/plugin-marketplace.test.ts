import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginLogos,
  createPluginMarketplace,
  parsePluginMarketplace,
  pluginLogoPng,
} from "./plugin-marketplace.js";

const registry = { name: "Cursor", repository: "https://github.com/example/plugins" };
const index = (plugins: unknown[]) => JSON.stringify({ name: "example", plugins });
const sha = "a".repeat(40);
const indexReads = (read: { mock: { calls: unknown[][] } }) =>
  read.mock.calls.filter(([url]) => String(url).endsWith("marketplace.json")).length;
afterEach(() => vi.restoreAllMocks());

describe("public marketplace indexes", () => {
  it("maps Cursor relative directories to importable sources", () => {
    const result = parsePluginMarketplace(
      index([{ name: "notes", source: "./notes", description: "Daily notes" }]),
      registry,
    );
    expect(result.entries).toEqual([
      {
        id: "Cursor:https://github.com/example/plugins#notes",
        name: "notes",
        displayName: "Notes",
        description: "Daily notes",
        keywords: [],
        category: null,
        logo: null,
        homepage: null,
        domains: [],
        registry: "Cursor",
        source: "https://github.com/example/plugins#notes",
        installedSource: "https://github.com/example/plugins#notes",
        hasConnector: false,
        skillCount: 0,
        community: true,
      },
    ]);
  });
  it("neutralises the host assistant in descriptions and marks entries without an owner", () => {
    const { entries } = parsePluginMarketplace(
      index([
        {
          name: "payments",
          source: "./payments",
          description: "Payments plugin for Grok Build: refunds and invoices.",
          domains: ["payments.example.test"],
        },
        { name: "style", source: "./style", author: { name: "A Person" } },
        { name: "owned", source: "./owned", author: { name: "xAI" } },
      ]),
      { name: "xAI", repository: "https://github.com/example/index" },
    );
    expect(
      entries.map(({ name, description, community }) => ({ name, description, community })),
    ).toEqual([
      { name: "payments", description: "Payments plugin: refunds and invoices.", community: false },
      { name: "style", description: "", community: true },
      { name: "owned", description: "", community: false },
    ]);
  });
  it("loads xAI local-directory source objects without allowing traversal", () => {
    const result = parsePluginMarketplace(
      index([
        { name: "neon", source: { type: "local", path: "./external_plugins/neon" } },
        { name: "escape", source: { type: "local", path: "./../escape" } },
      ]),
      { name: "xAI", repository: "https://github.com/example/index" },
    );
    expect(result.entries[0]?.source).toBe(
      "https://github.com/example/index#external_plugins/neon",
    );
    expect(result.skipped).toBe(1);
  });
  it("preserves xAI URL-object pins and canonical installed identity", () => {
    const result = parsePluginMarketplace(
      index([
        {
          name: "tasks",
          source: { source: "url", url: "https://github.com/Example/Tasks.git", sha },
          keywords: ["planning"],
        },
      ]),
      { name: "xAI", repository: "https://github.com/example/index" },
    );
    expect(result.entries[0]).toMatchObject({
      source: `https://github.com/example/tasks@${sha}`,
      installedSource: "https://github.com/example/tasks",
      registry: "xAI",
      keywords: ["planning"],
    });
  });
  it("loads direct GitHub sources, reports invalid entries and removes duplicates", () => {
    const result = parsePluginMarketplace(
      index([
        { name: "valid", source: "https://github.com/example/valid/tree/main/subdir" },
        { name: "duplicate", source: "https://github.com/example/valid@main#subdir" },
        { name: "traversal", source: "../escape" },
        { name: "absolute", source: "/root" },
        { name: "private", source: "https://127.0.0.1/a/b" },
        { name: "credentials", source: "https://user:password@github.com/a/b" },
        {
          name: "bad-pin",
          source: { source: "url", url: "https://github.com/example/tasks", sha: "main" },
        },
        {
          name: "conflicting",
          source: { source: "url", url: "https://github.com/example/tasks@other", sha },
        },
      ]),
      registry,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toBe(7);
  });
  it("keeps the subdirectory of a pinned URL source", () => {
    const result = parsePluginMarketplace(
      index([
        {
          name: "stripe",
          source: {
            source: "url",
            url: "https://github.com/stripe/ai.git",
            sha,
            path: "providers/grok",
          },
          category: "Payments",
          homepage: "https://stripe.com",
          domains: ["stripe.com"],
        },
      ]),
      { name: "xAI", repository: "https://github.com/example/index" },
    );
    expect(result.entries[0]).toMatchObject({
      source: `https://github.com/stripe/ai@${sha}#providers/grok`,
      category: "payments",
      homepage: "https://stripe.com",
      domains: ["stripe.com"],
    });
  });
  it("rejects malformed or oversized index structure", () => {
    expect(() => parsePluginMarketplace("invalid", registry)).toThrow();
    expect(() => parsePluginMarketplace(JSON.stringify({ plugins: {} }), registry)).toThrow();
    expect(() => parsePluginMarketplace(index(Array(1001).fill({})), registry)).toThrow();
  });
});

/** Registry files a fake GitHub serves: indexes, the Cursor repo listing, the xAI component
 * index, and per-plugin manifests and MCP configs. */
function registryReader(files: {
  cursor: unknown[];
  xai?: unknown[] | Error;
  tree?: string[];
  components?: Record<string, { sha?: string; components: Record<string, unknown[]> }>;
  text?: Record<string, string>;
}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("xai-org/plugin-marketplace/HEAD/.grok-plugin/marketplace.json")) {
      if (files.xai instanceof Error) throw files.xai;
      return index(files.xai ?? []);
    }
    if (url.endsWith("plugin-index.json"))
      return JSON.stringify({ version: 1, plugins: files.components ?? {} });
    if (url.endsWith(".cursor-plugin/marketplace.json")) return index(files.cursor);
    if (url.includes("api.github.com/repos/cursor/plugins/git/trees/"))
      return JSON.stringify({
        tree: (files.tree ?? []).map((path) => ({ path, type: "blob" })),
      });
    const own = Object.entries(files.text ?? {}).find(([suffix]) => url.endsWith(suffix));
    if (own) return own[1];
    throw new Error(`Not found: ${url}`);
  });
}
const remoteMcp = JSON.stringify({
  mcpServers: { tools: { type: "http", url: "https://tools.example.test/mcp" } },
});

describe("marketplace service", () => {
  it("filters metadata, caches success, and does not cache provider failures", async () => {
    const files: Parameters<typeof registryReader>[0] = {
      cursor: [{ name: "Notes", description: "Daily planning", source: "notes" }],
      xai: new Error("Unavailable"),
      tree: ["notes/skills/plan/SKILL.md"],
      components: { Tasks: { components: { skills: [{}] } } },
    };
    const read = registryReader(files);
    const service = createPluginMarketplace(read);
    const first = await service.catalog("PLANNING daily");
    expect(first.entries.map((entry) => entry.name)).toEqual(["Notes"]);
    expect(first.unavailableRegistries).toEqual(["xAI"]);
    files.xai = [
      { name: "Tasks", source: { type: "local", path: "./tasks" }, keywords: ["planning"] },
    ];
    const second = await service.catalog("planning");
    expect(second.entries.map((entry) => entry.name)).toEqual(["Notes", "Tasks"]);
    expect(second.unavailableRegistries).toEqual([]);
    expect(indexReads(read)).toBe(3);
    await service.catalog("no match");
    expect(indexReads(read)).toBe(3);
  });
  it("shares concurrent reads and refreshes an expired catalog in the background", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const read = registryReader({
      cursor: [{ name: "Notes", source: "notes" }],
      tree: ["notes/skills/plan/SKILL.md"],
    });
    const service = createPluginMarketplace(read);
    await Promise.all([service.catalog(""), service.catalog("Notes")]);
    expect(indexReads(read)).toBe(2);
    now.mockReturnValue(1000 + 10 * 60_000 + 1);
    const stale = await service.catalog("");
    expect(stale.entries).toHaveLength(1);
    await vi.waitFor(() => expect(indexReads(read)).toBe(4));
  });
  it("reads the title, category and logo of vendored plugins from their manifests", async () => {
    const read = registryReader({
      cursor: [
        { name: "mail", source: "mail" },
        { name: "notes", source: "notes" },
      ],
      tree: ["mail/skills/send/SKILL.md", "notes/skills/plan/SKILL.md"],
      text: {
        "/mail/.cursor-plugin/plugin.json": JSON.stringify({
          displayName: "Mail",
          category: "Productivity",
          logo: "assets/logo.svg",
          author: { name: "Cursor", email: "plugins@example.test" },
        }),
        "/notes/.cursor-plugin/plugin.json": JSON.stringify({
          logo: "../../escape.svg",
          author: { name: "A Person" },
        }),
      },
    });
    const { entries } = await createPluginMarketplace(read).catalog("");
    const logo = Buffer.from("mail/assets/logo.svg").toString("base64url");
    expect(entries).toMatchObject([
      {
        name: "mail",
        displayName: "Mail",
        category: "productivity",
        logo: `/api/v1/plugin-logos/Cursor/${logo}.png`,
        community: false,
      },
      { name: "notes", displayName: "Notes", category: null, logo: null, community: true },
    ]);
  });
  it("lists only plugins whose every part installs, and says which have a connector", async () => {
    const read = registryReader({
      cursor: [
        { name: "app", source: "app" },
        { name: "pack", source: "pack" },
        { name: "hooked", source: "hooked" },
        { name: "local-mcp", source: "local-mcp" },
        { name: "templated", source: "templated" },
        { name: "references", source: "references" },
        { name: "elsewhere", source: "https://github.com/example/elsewhere" },
      ],
      tree: [
        "app/mcp.json",
        "app/agents/reviewer.md",
        "app/commands/deploy.md",
        "app/commands/_shared.md",
        "app/assets/logo.svg",
        "pack/skills/plan/SKILL.md",
        "pack/skills/write/SKILL.md",
        "hooked/skills/plan/SKILL.md",
        "hooked/hooks/hooks.json",
        "local-mcp/mcp.json",
        "templated/mcp.json",
        "references/skills/plan/SKILL.md",
        "references/skills/plan/references/api.md",
      ],
      components: {
        hosted: { sha, components: { mcpServers: [{ description: "http" }], skills: [{}] } },
        stdio: { sha, components: { mcpServers: [{ description: "stdio" }] } },
        moved: { sha: "b".repeat(40), components: { skills: [{}] } },
      },
      xai: [
        {
          name: "hosted",
          source: { source: "url", url: "https://github.com/example/hosted", sha },
        },
        { name: "stdio", source: { source: "url", url: "https://github.com/example/stdio", sha } },
        { name: "moved", source: { source: "url", url: "https://github.com/example/moved", sha } },
      ],
      text: {
        "/app/mcp.json": remoteMcp,
        "/local-mcp/mcp.json": JSON.stringify({ mcpServers: { cli: { command: "npx" } } }),
        "/templated/mcp.json": JSON.stringify({
          // biome-ignore lint/suspicious/noTemplateCurlyInString: an unfilled credential placeholder
          mcpServers: { api: { type: "http", url: "https://api.example.test/${TENANT}" } },
        }),
      },
    });
    const { entries, skippedEntries } = await createPluginMarketplace(read).catalog("");
    expect(
      entries.map(({ name, hasConnector, skillCount }) => ({ name, hasConnector, skillCount })),
    ).toEqual([
      { name: "app", hasConnector: true, skillCount: 2 },
      { name: "hosted", hasConnector: true, skillCount: 1 },
      { name: "pack", hasConnector: false, skillCount: 2 },
      { name: "references", hasConnector: false, skillCount: 1 },
    ]);
    expect(skippedEntries).toBe(6);
  });
  it("leaves out plugins whose connector works only in the catalog's own app", async () => {
    const server = (url: string, extra = {}) =>
      JSON.stringify({ mcpServers: { tools: { type: "http", url, ...extra } } });
    const read = registryReader({
      cursor: ["drive", "relay", "header", "client", "lookalike"].map((name) => ({
        name,
        source: name,
      })),
      tree: [
        "drive/mcp.json",
        "drive/skills/find/SKILL.md",
        "relay/mcp.json",
        "header/mcp.json",
        "client/mcp.json",
        "lookalike/mcp.json",
      ],
      text: {
        "/drive/mcp.json": server("https://API.cursor.com/rest-mcp/google-drive/mcp"),
        "/relay/mcp.json": server("https://gateway.grok.com/mcp"),
        "/header/mcp.json": server("https://mcp.example.test/mcp", {
          headers: { "X-Cursor-Plugin": "header" },
        }),
        "/client/mcp.json": server("https://mcp.example.test/mcp", {
          auth: { CLIENT_ID: "vendor-app" },
        }),
        "/lookalike/mcp.json": server("https://api.cursor.com.example.test/mcp"),
      },
    });
    const { entries, skippedEntries } = await createPluginMarketplace(read).catalog("");
    expect(entries.map((entry) => entry.name)).toEqual(["lookalike"]);
    expect(skippedEntries).toBe(4);
  });
  it("returns explicit unavailability without leaking provider errors", async () => {
    const service = createPluginMarketplace(async () => {
      throw new Error("private diagnostic");
    });
    expect(await service.catalog("")).toEqual({
      entries: [],
      unavailableRegistries: ["Cursor", "xAI"],
      skippedEntries: 0,
    });
  });
});

const svgLogo = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#123456"/></svg>',
);
const logoKey = (path: string) => `${Buffer.from(path).toString("base64url")}.png`;

describe("plugin logos", () => {
  it("serves a registry logo as a cached PNG from the server", async () => {
    const read = vi.fn(async () => svgLogo);
    const logos = createPluginLogos({ read });
    const png = await logos.logo("Cursor", logoKey("mail/assets/logo.svg"));
    expect(read).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/cursor/plugins/HEAD/mail/assets/logo.svg",
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(Buffer.from(png!.subarray(1, 4)).toString()).toBe("PNG");
    expect(await logos.logo("Cursor", logoKey("mail/assets/logo.svg"))).toBe(png);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("refuses anything but an image file in a known registry", async () => {
    const read = vi.fn(async () => svgLogo);
    const logos = createPluginLogos({ read });
    for (const [registry, file] of [
      ["Elsewhere", logoKey("mail/assets/logo.svg")],
      ["Cursor", logoKey("../escape/logo.svg")],
      ["Cursor", logoKey("/etc/logo.svg")],
      ["Cursor", logoKey("mail/.cursor-plugin/plugin.json")],
      ["Cursor", "mail/assets/logo.svg"],
    ] as const)
      expect(await logos.logo(registry, file)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("asks a listed source for the logos of its own entries", async () => {
    const read = vi.fn(async () => svgLogo);
    const source = vi.fn(async (key: string) =>
      key === "sub-1" ? "https://cdn.example.test/logo.svg" : null,
    );
    const logos = createPluginLogos({ read, sources: { RoBots: source } });
    expect(await logos.logo("RoBots", "sub-1.png")).not.toBeNull();
    expect(read).toHaveBeenCalledWith(
      "https://cdn.example.test/logo.svg",
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(await logos.logo("RoBots", "sub-2.png")).toBeNull();
    expect(await logos.logo("constructor", "sub-1.png")).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("remembers a missing logo but retries other failures", async () => {
    const read = vi
      .fn<(url: string) => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error("Request failed: HTTP 500"))
      .mockRejectedValueOnce(new Error("Request failed: HTTP 404"));
    const logos = createPluginLogos({ read });
    expect(await logos.logo("xAI", logoKey("neon/logo.png"))).toBeNull();
    expect(await logos.logo("xAI", logoKey("neon/logo.png"))).toBeNull();
    expect(await logos.logo("xAI", logoKey("neon/logo.png"))).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("draws raster and SVG logos and rejects anything else", async () => {
    const fromSvg = await pluginLogoPng(svgLogo);
    expect(fromSvg).not.toBeNull();
    expect(await pluginLogoPng(fromSvg!)).not.toBeNull();
    expect(await pluginLogoPng(new TextEncoder().encode("<html><script></script></html>"))).toBe(
      null,
    );
  });
});
