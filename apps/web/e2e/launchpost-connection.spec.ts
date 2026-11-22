import { expect, test } from "@playwright/test";
import type { McpServer, RobotsDesktopOAuthCallback } from "@robots/contracts";
import { REMOTE_APP_NATIVE_CALLBACK } from "@robots/core";
import { openBrowserAuth } from "../../desktop/src/browser-auth";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

declare global {
  interface Window {
    openSystemBrowser: (url: string) => Promise<void>;
  }
}

test("Launchpost is listed in Connect apps and opens to a one-click Connect", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signup(page, `launchpost-${Date.now()}@robots.test`, "password12", "Launchpost");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true });
  const available = dialog.getByTestId("featured-connectors");
  const row = available.getByTestId("plugin-row").filter({ hasText: "Launchpost" });
  await expect(row).toContainText("Schedule and publish social posts.");
  await expect(available).not.toContainText(/Grok|Claude|Cursor|Codex|Copilot/);
  const sections = dialog.locator(
    '[data-testid="connected-integrations"], [data-testid="mac-apps"], [data-testid="featured-connectors"]',
  );
  expect(
    await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid"))),
  ).toEqual(["mac-apps", "featured-connectors"]);
  await expect(available.getByRole("heading", { level: 2 })).toHaveText("Available");
  const monogram = row.locator("div").first();
  await expect(monogram).toHaveText("L");
  const [ink, plate] = await monogram.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor];
  });
  expect(ink).not.toBe(plate);
  await captureScreenshot(page, testInfo, "launchpost-in-connect-apps");

  await row.getByRole("button", { name: "Add", exact: true }).click();
  const detail = page.getByTestId("connection-detail");
  await expect(detail.getByRole("heading", { name: "Launchpost" })).toBeVisible();
  await expect(detail.getByText("Launchpost account", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "launchpost-connection-page");

  await page.getByRole("dialog").getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("textbox", { name: "Search apps" }).fill("social posts");
  await expect(dialog.getByTestId("remote-mcp-apps")).toContainText("Launchpost");
});

test("Connect signs in through the current tab and grants the selected bot access after consent", async ({
  page,
}) => {
  await signup(page, `remote-app-${Date.now()}@robots.test`, "password12", "Remote app");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const origin = new URL(page.url()).origin;
  await page.context().route("https://marketplace-auth.example.test/authorize**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("redirect_uri")).toBe(`${origin}/mcp/oauth/callback`);
    expect(params.get("code_challenge_method")).toBe("S256");
    const callback = new URL("/mcp/oauth/callback", origin);
    callback.searchParams.set("state", params.get("state")!);
    callback.searchParams.set("code", "fixture-code");
    await route.fulfill({
      contentType: "text/html",
      body: `<a href="${callback.href}">Approve</a>`,
    });
  });
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  const row = page.getByTestId("plugin-row").filter({ hasText: "Launchpost" });
  await row.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("link", { name: "Approve" })).toBeVisible();
  const servers = await rpc<McpServer[]>(page, "mcp/servers/list", {});
  const server = servers.find((item) => item.name === "Launchpost")!;
  expect(server.oauthStatus).not.toBe("connected");
  await page.getByRole("link", { name: "Approve" }).click();
  await page.waitForURL(/\/app(?:[/?]|$)/);
  const saved = await rpc<McpServer[]>(page, "mcp/servers/list", {});
  expect(saved.find((item) => item.id === server.id)?.oauthStatus).toBe("connected");
  expect(await rpc(page, "mcp/assignments/list", { botId })).toEqual(
    expect.arrayContaining([expect.objectContaining({ serverId: server.id, botId })]),
  );
});

test("desktop Connect returns from the system browser through the native OAuth listener", async ({
  browser,
  page,
}) => {
  await signup(page, `native-remote-${Date.now()}@robots.test`, "password12", "Remote app");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await page
    .getByTestId("plugin-row")
    .filter({ hasText: "Launchpost" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const installed = await rpc<McpServer>(page, "mcp/servers/create", {
    name: "Launchpost",
    slug: "existing-launchpost",
    transport: "streamable_http",
    endpoint: "https://launchpost.app/api/mcp/other",
  });
  const previous = await rpc<{ authorizationUrl: string }>(page, "mcp/oauth/begin", {
    serverId: installed.id,
    redirectUri: new URL("/mcp/oauth/callback", page.url()).href,
  });
  const browserClient = new URL(previous.authorizationUrl).searchParams.get("client_id");
  expect(browserClient).toBeTruthy();
  const system = await browser.newContext();
  const external = await system.newPage();
  const controller = new AbortController();
  try {
    await external.route("https://marketplace-auth.example.test/authorize**", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get("redirect_uri")).toBe(REMOTE_APP_NATIVE_CALLBACK);
      expect(params.get("client_id")).not.toBe(browserClient);
      const callback = new URL(REMOTE_APP_NATIVE_CALLBACK);
      callback.searchParams.set("state", params.get("state")!);
      callback.searchParams.set("code", "fixture-code");
      await route.fulfill({
        contentType: "text/html",
        body: `<a href="${callback.href}">Approve</a>`,
      });
    });
    await page.exposeFunction("openSystemBrowser", (url: string) =>
      openBrowserAuth(url, {
        signal: controller.signal,
        openExternal: (target) => external.goto(target),
        onCallback: (detail) =>
          void page.evaluate(
            (value) => window.dispatchEvent(new CustomEvent("native-callback", { detail: value })),
            detail,
          ),
      }),
    );
    await page.evaluate(() => {
      Object.assign(window, {
        robotsDesktop: {
          platform: "darwin",
          oauth: {
            open: window.openSystemBrowser,
            onCallback: (listener: (result: RobotsDesktopOAuthCallback) => void) => {
              const handle = (event: Event) =>
                listener((event as CustomEvent<RobotsDesktopOAuthCallback>).detail);
              window.addEventListener("native-callback", handle);
              return () => window.removeEventListener("native-callback", handle);
            },
          },
        },
      });
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(external.getByRole("link", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await external.getByRole("link", { name: "Approve" }).click();
    await expect(page.getByTestId("connection-accounts")).toContainText("Connected");
    const [server] = await rpc<McpServer[]>(page, "mcp/servers/list", {});
    expect(server?.oauthStatus).toBe("connected");
    expect(await rpc(page, "mcp/assignments/list", { botId })).toEqual(
      expect.arrayContaining([expect.objectContaining({ serverId: server!.id, botId })]),
    );
  } finally {
    controller.abort();
    await system.close();
  }
});
