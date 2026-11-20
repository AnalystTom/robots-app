// @vitest-environment jsdom
import type { DesktopUpdateState } from "@robots/contracts";
import type * as MobileAppLinks from "@robots/contracts/mobile-app-links";
import { Toaster } from "@robots/ui-web";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdatesProvider } from "./DesktopUpdates";
import { SidebarFooter, sidebarMarkCount } from "./SidebarFooter";

const mobileLinks = vi.hoisted((): { ios?: string; android?: string } => ({}));

vi.mock("@robots/contracts/mobile-app-links", async (importOriginal) => ({
  ...(await importOriginal<typeof MobileAppLinks>()),
  MOBILE_APP_LINKS: mobileLinks,
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  delete mobileLinks.ios;
  delete mobileLinks.android;
  await act(async () => root.unmount());
  host.remove();
  delete window.robotsDesktop;
  vi.restoreAllMocks();
});
async function render(
  name = "Demo User",
  image?: string,
  onIntegrations = vi.fn(),
  onBoard?: () => void,
  logos?: Array<{ name: string; logo?: string }>,
) {
  const email = "account@robots.test";
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          logos={logos}
          name={name}
          initials={name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
          image={image}
          email={email}
          open
          onOpenChange={() => {}}
          onIntegrations={onIntegrations}
          onSkills={vi.fn()}
          onBoard={onBoard}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
        />
        <Toaster />
      </DesktopUpdatesProvider>,
    ),
  );
}
function bridge(phase: DesktopUpdateState["phase"]) {
  const state: DesktopUpdateState = {
    phase,
    currentVersion: "0.1.0",
    availableVersion: "0.2.0",
    percent: null,
    message: null,
    checkedAt: null,
  };
  const install = vi.fn(async () => state);
  window.robotsDesktop = {
    platform: "darwin",
    window: {
      close: async () => {},
      minimize: async () => {},
      toggleMaximize: async () => {},
      state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
    },
    oauth: { onCallback: () => () => {} },
    update: {
      state: async () => state,
      install,
      download: async () => state,
      check: async () => state,
    },
  };
  return install;
}
it("hides update controls without a desktop bridge", async () => {
  await render();
  expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
});
it.each(["unsupported", "idle", "available", "downloading", "checking", "error"] as const)(
  "hides install controls in phase %s",
  async (phase) => {
    bridge(phase);
    await render();
    expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
    expect(document.body.textContent).not.toContain("New update available");
  },
);
it("installs the ready update only through the footer button", async () => {
  const install = bridge("ready");
  await render("Ada Lovelace");
  const icon = document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!;
  expect(icon).not.toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
  await act(async () => icon.click());
  expect(install).toHaveBeenCalledTimes(1);
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "Install"),
  ).toBe(false);
});
it("shows the account image and falls back to the initial after a load error", async () => {
  await render("Ada Lovelace", "https://example.test/avatar.png");
  const trigger = host.querySelector('[data-testid="user-menu-trigger"]')!;
  const image = trigger.querySelector("img")!;
  expect(image.src).toBe("https://example.test/avatar.png");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(trigger.querySelector("img")).toBeNull();
  expect(trigger.textContent).toBe("AL");
});

it("opens integrations and keeps the existing account actions and links", async () => {
  const onIntegrations = vi.fn();
  await render("Demo User", undefined, onIntegrations, vi.fn());
  const connect = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => connect.click());
  expect(onIntegrations).toHaveBeenCalledOnce();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect([...menu.querySelectorAll("button, a")].map((row) => row.textContent)).toEqual([
    "Settings",
    "Skills",
    "Artifacts",
    "Board",
    "Docs",
    "Log out",
  ]);
  expect(host.querySelector('[data-testid="user-menu-trigger"]')?.getAttribute("aria-label")).toBe(
    "Account menu for Demo User",
  );
});
it("omits Board when unavailable", async () => {
  await render();
  expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain(
    "Board",
  );
});

it.each(["Android", "iPhone", "Macintosh"])(
  "offers no mobile app on %s while RoBots has no store listing",
  async (userAgent) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
    await render();
    const menu = document.querySelector('[data-slot="popover-content"]')!;
    expect(menu.textContent).not.toContain("Get the mobile app");
  },
);

it("offers the visitor's own store listing when RoBots has one", async () => {
  mobileLinks.ios = "https://apps.example/ios-robots";
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  await render();
  const link = [...document.querySelectorAll('[data-slot="popover-content"] a')].find((a) =>
    a.textContent?.includes("Get the mobile app"),
  );
  expect(link?.getAttribute("href")).toBe("https://apps.example/ios-robots");
});

it("offers the iOS listing to an iPad in desktop mode", async () => {
  mobileLinks.ios = "https://apps.example/ios-robots";
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
  Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
  await render();
  const link = [...document.querySelectorAll('[data-slot="popover-content"] a')].find((a) =>
    a.textContent?.includes("Get the mobile app"),
  );
  expect(link?.getAttribute("href")).toBe("https://apps.example/ios-robots");
});

it("hides a store listing from the other platform", async () => {
  mobileLinks.ios = "https://apps.example/ios-robots";
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux; Android 15");
  await render();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect(menu.textContent).not.toContain("Get the mobile app");
});

it("falls back when app artwork fails and accepts replacement artwork", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/slack.svg" },
  ]);
  const pill = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => pill.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(pill.querySelector("img")).toBeNull();
  expect(pill.textContent).toContain("S");
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/new-slack.svg" },
  ]);
  expect(pill.querySelector("img")?.src).toBe("https://example.test/new-slack.svg");
});
it.each(["throw", "state"] as const)(
  "reveals a %s install failure after Later",
  async (failure) => {
    const install = bridge("ready");
    if (failure === "throw") install.mockRejectedValueOnce(new Error("offline"));
    else
      install.mockResolvedValueOnce({
        ...(await window.robotsDesktop!.update.state()),
        phase: "error",
        message: "Update could not be installed",
      });
    await render();
    const notice = () => document.querySelector('[aria-label="Desktop update"]');
    const later = () =>
      [...notice()!.querySelectorAll("button")].find((button) => button.textContent === "Later")!;
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    await act(async () => later().click());
    await vi.waitFor(() => expect(notice()).toBeNull());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!.click(),
    );
    await vi.waitFor(() =>
      expect(notice()?.querySelector('[role="status"]')?.textContent).toBe(
        failure === "throw"
          ? "Could not complete the update. Try again."
          : "Update could not be installed",
      ),
    );
    await act(async () => later().click());
    await vi.waitFor(() => expect(notice()).toBeNull());
  },
);

it.each([
  [-20, 0],
  [0, 0],
  [25, 0],
  [26, 1],
  [47, 1],
  [48, 2],
  [69, 2],
  [70, 3],
  [200, 3],
])("fits marks into %ipx without consuming label or padding space", (width, count) => {
  expect(sidebarMarkCount(width)).toBe(count);
});

it("keeps at most three marks with the same tile and a missing-logo fallback", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Gmail", logo: "https://example.test/gmail.svg" },
    { name: "Notion" },
    { name: "GitHub", logo: "https://example.test/github.svg" },
    { name: "Slack" },
  ]);
  const tiles = [...host.querySelectorAll('span[aria-hidden="true"] > span')];
  expect(tiles).toHaveLength(3);
  expect(new Set(tiles.map((tile) => tile.className)).size).toBe(1);
  expect(tiles[1]!.textContent).toBe("N");
});

const personal = {
  id: "org-personal",
  name: "Personal",
  defaultSpaceId: "s1",
  spaceIds: ["s1"],
  canManage: true,
  personal: true,
};
const work = {
  id: "org-work",
  name: "Work",
  defaultSpaceId: "s2",
  spaceIds: ["s2"],
  canManage: true,
  personal: false,
};

async function renderOrganizations(
  organizations: (typeof personal)[],
  onSwitchOrganization = vi.fn(),
) {
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          name="Demo User"
          initials="DU"
          email="account@robots.test"
          open
          onOpenChange={() => {}}
          onIntegrations={() => {}}
          onSkills={() => {}}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
          organizations={organizations}
          activeOrganizationId="org-personal"
          onSwitchOrganization={onSwitchOrganization}
        />
      </DesktopUpdatesProvider>,
    ),
  );
  return [...document.querySelector('[data-slot="popover-content"]')!.querySelectorAll("button")];
}

it("shows no organization rows with one organization", async () => {
  const rows = await renderOrganizations([personal]);
  expect(rows[0]!.textContent).toBe("Settings");
});

it("lists two organizations with the active one checked", async () => {
  const onSwitch = vi.fn();
  const rows = await renderOrganizations([personal, work], onSwitch);
  expect(rows.map((row) => row.textContent).slice(0, 3)).toEqual(["Personal", "Work", "Settings"]);
  expect(rows[0]!.getAttribute("aria-current")).toBe("true");
  expect(rows[0]!.querySelector("svg")).not.toBeNull();
  expect(rows[1]!.hasAttribute("aria-current")).toBe(false);
  expect(rows[1]!.querySelector("svg")).toBeNull();
  await act(async () => rows[1]!.click());
  expect(onSwitch).toHaveBeenCalledWith(work);
});

it("marks the personal organization once another one shares its name", async () => {
  const renamed = { ...personal, name: "Northwind" };
  const rows = await renderOrganizations([renamed, { ...work, name: "Northwind" }]);
  expect(rows.map((row) => row.textContent).slice(0, 2)).toEqual([
    "NorthwindPersonal",
    "Northwind",
  ]);
});
