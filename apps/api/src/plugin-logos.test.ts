import { createPluginLogos, createPluginMarketplace } from "@robots/adapters";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountPluginLogos } from "./plugin-logos.js";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="4"/></svg>';

function catalogReader() {
  return vi.fn(async (url: string) => {
    if (url.endsWith(".cursor-plugin/marketplace.json"))
      return JSON.stringify({ plugins: [{ name: "mail", source: "mail" }] });
    if (url.endsWith(".grok-plugin/marketplace.json")) return JSON.stringify({ plugins: [] });
    if (url.endsWith("plugin-index.json")) return JSON.stringify({ plugins: {} });
    if (url.includes("/git/trees/"))
      return JSON.stringify({ tree: [{ path: "mail/skills/send/SKILL.md", type: "blob" }] });
    if (url.endsWith("/mail/.cursor-plugin/plugin.json"))
      return JSON.stringify({ logo: "assets/logo.svg" });
    throw new Error("Request failed: HTTP 404");
  });
}

describe("plugin logo route", () => {
  it("serves the logo a catalog entry names, fetched by the server", async () => {
    const { entries } = await createPluginMarketplace(catalogReader()).catalog("");
    const logo = entries[0]!.logo!;
    expect(logo).toMatch(/^\/api\/v1\/plugin-logos\//);
    expect(logo).not.toContain("githubusercontent");

    const fetchLogo = vi.fn(async () => new TextEncoder().encode(svg));
    const app = new Hono();
    mountPluginLogos(app, createPluginLogos({ read: fetchLogo }));
    const response = await app.request(logo);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(body.subarray(1, 4)).toString()).toBe("PNG");
    expect(fetchLogo).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/cursor/plugins/HEAD/mail/assets/logo.svg",
      expect.any(Number),
      expect.any(AbortSignal),
    );
  });

  it("answers 404 for a logo it cannot serve", async () => {
    const app = new Hono();
    mountPluginLogos(
      app,
      createPluginLogos({
        read: async () => {
          throw new Error("Request failed: HTTP 404");
        },
      }),
    );
    const response = await app.request("/api/v1/plugin-logos/Cursor/bWFpbC9sb2dvLnN2Zw.png");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await app.request("/api/v1/plugin-logos/Cursor/not-a-logo")).status).toBe(404);
  });
});
