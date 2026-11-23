import type { PluginLogos } from "@robots/adapters";
import { PLUGIN_LOGO_PATH } from "@robots/contracts";
import type { Hono } from "hono";

export function mountPluginLogos(app: Hono, logos: PluginLogos) {
  app.get(`${PLUGIN_LOGO_PATH}/:registry/:file`, async (c) => {
    const png = await logos.logo(c.req.param("registry"), c.req.param("file"));
    if (!png) return c.body(null, 404, { "cache-control": "no-store" });
    return c.body(png, 200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    });
  });
}
