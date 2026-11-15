import { ENVIRONMENT_PATH, EnvironmentSchema } from "@robots/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { environmentId, mountEnvironmentRoute } from "./environment-id.js";

describe("environment id", () => {
  it("is stable per secret and differs between deployments", () => {
    expect(environmentId("secret-a")).toBe(environmentId("secret-a"));
    expect(environmentId("secret-a")).not.toBe(environmentId("secret-b"));
    expect(environmentId("secret-a")).not.toContain("secret-a");
  });

  it("is served publicly and never cached", async () => {
    const app = new Hono();
    mountEnvironmentRoute(app, "secret-a");
    const response = await app.request(ENVIRONMENT_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(EnvironmentSchema.parse(await response.json())).toEqual({
      id: environmentId("secret-a"),
    });
  });
});
