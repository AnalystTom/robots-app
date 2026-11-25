// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveBotGlyph, CollaborationMarker } from "./CollaborationMarker";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(element: ReactElement): HTMLDivElement {
  act(() => root.render(element));
  return container;
}

describe("collaboration transcript markers", () => {
  it("shows a centred peer event with its avatar and full label", () => {
    const mounted = render(
      <CollaborationMarker
        peerName="Research"
        color="#14B8A6"
        identity="research"
        label="Message from Research"
        onClick={() => undefined}
      />,
    );
    const html = mounted.innerHTML;
    const chip = mounted.querySelector('[data-testid="peer-receipt-chip"]');
    const avatarImage = chip?.querySelector("img");

    expect(chip?.getAttribute("aria-label")).toBe("Message from Research");
    expect(avatarImage?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(html).toContain('class="flex min-w-0 max-w-full justify-center"');
    expect(html).toContain('class="inline-flex max-w-full');
    expect(html).toContain("truncate font-medium");
    expect(html).toContain("Message from Research");
    expect(html).not.toContain("{peer}");
    expect(html).not.toContain("peer-replies-toggle");
  });

  it("animates the active bot glyph from its run status", () => {
    const mounted = render(
      <ActiveBotGlyph
        bots={[{ botId: "research", color: "#14B8A6", status: "running" }]}
        label="Searching the web: injury news"
      />,
    );
    const status = mounted.querySelector('[role="status"]');

    expect(status).not.toBeNull();
    expect(status?.querySelector('[data-working="true"]')).not.toBeNull();
  });
});
