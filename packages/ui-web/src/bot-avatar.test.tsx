import { ACTIVE_RUN_STATUSES } from "@robots/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_COLORS,
  BotAvatar,
  BotShapePreview,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

describe("BotAvatar", () => {
  it.each([
    ["a plain colour", "#F97316", "robots" as const],
    ["a plain colour in the original set", "#F97316", "organic" as const],
    ["an organic shape", "#8B5CF6::shape_3", undefined],
  ])("draws %s as a preset robot", (_name, color, avatarSet) => {
    const html = renderToString(<BotAvatar color={color} avatarSet={avatarSet} identity="bot-1" />);
    expect(html).toMatch(/<img[^>]*src="data:image\/svg\+xml/);
  });

  it.each([...ACTIVE_RUN_STATUSES])("marks active run status %s as working", (status) => {
    const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
    expect(html).toContain("robots-bot-avatar-ring-working");
    expect(html).toContain('data-working="true"');
  });

  it("keeps working attribute false when idle", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
  });

  it("renders different preset robots for different bot identities", () => {
    const looks = new Set(
      Array.from({ length: 30 }, (_, index) =>
        renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity={`bot-${index}`} />),
      ),
    );
    expect(looks.size).toBeGreaterThan(8);
  });

  it("parses shape indexes from encoded color values", () => {
    const parsed = parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`);
    expect(parsed.color).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(parsed.shapeIndex).toBe(3);
    expect(parsed.isImage).toBe(false);
  });

  it("normalizes malformed shape suffixes to shape 0", () => {
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_-1`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3junk`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_`).shapeIndex).toBe(0);
  });

  it("resolves explicit colors and shapes", () => {
    expect(resolvePersonaColorDef("bot", "#10B981").hex).toBe("#00C972");
    expect(resolvePersonaColorDef("bot", "#fff").hex).toBe("#fff");
    expect(BOT_COLORS.length).toBeGreaterThan(0);
  });

  it("falls back to the identity palette for invalid custom hex", () => {
    expect(resolvePersonaColorDef("bot", "#zzzzzz")).toEqual(resolvePersonaColorDef("bot"));
    expect(resolvePersonaColorDef("bot", "#ggg")).toEqual(resolvePersonaColorDef("bot"));
  });

  it("renders uploaded images without the geometric svg", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} />,
    );
    expect(html).toContain("<img");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("bot-character-eyes");
  });

  it("keeps a working photo ring outside the clipped image and uses the status token", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('class="robots-bot-avatar relative shrink-0 select-none"');
    expect(html).toContain("robots-bot-avatar-picture");
    expect(html).toContain("robots-bot-avatar-ring-working");
    expect(html).toContain("stroke-status-working");
    expect(html).toContain('data-working="true"');
    expect(html.indexOf("robots-bot-avatar-picture")).toBeLessThan(
      html.indexOf("robots-bot-avatar-ring"),
    );
  });

  it("keeps idle photo avatars ring-free", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="idle" />,
    );
    expect(html).toContain("robots-bot-avatar-picture");
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("robots-bot-avatar-ring");
  });

  it("draws a robot character as an image in any set, sized and ringed like a photo", () => {
    const value = "robot:red.chef-hat.grumpy.chef-jacket.steam";
    for (const avatarSet of ["organic", "robots"] as const) {
      const html = renderToString(
        <BotAvatar color={value} avatarSet={avatarSet} identity="b1" size={40} status="running" />,
      );
      expect(html).toMatch(/<img src="data:image\/svg\+xml,%3Csvg[^"]*"/);
      expect(html).toContain("width:40px;height:40px");
      expect(html).toContain('data-working="true"');
      expect(html).toContain("robots-bot-avatar-ring-working");
    }
    expect(defaultBotAvatarValue(value)).toBe("#D9483B");
    expect(resolvePersonaColorDef("b1", value).hex).toBe("#D9483B");
  });

  it("does not draw a robot value that names an unknown part", () => {
    const html = renderToString(
      <BotAvatar color={'robot:red."><script>x</script>.grumpy.chef-jacket.none'} size={32} />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("unknown");
  });

  it("does not treat arbitrary http(s) color values as remote images", () => {
    const parsed = parseBotAvatar("https://evil.example/track.png");
    expect(parsed.isImage).toBe(false);
    expect(parsed.imageUrl).toBeUndefined();
    const html = renderToString(
      <BotAvatar color="https://evil.example/track.png" identity="maya" size={32} />,
    );
    expect(html).not.toContain("evil.example");
  });

  it("restores a plain color that renders the organic body instead of a pinned shape", () => {
    expect(defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)).toBe(
      DEFAULT_BOT_AVATAR_COLOR,
    );
    expect(defaultBotAvatarValue("#EAB308::shape_1")).toBe("#EAB308");
    expect(defaultBotAvatarValue("#abc::shape_2")).toBe("#abc");
    expect(defaultBotAvatarValue("#fff")).toBe("#fff");
    expect(defaultBotAvatarValue("data:image/png;base64,abc")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("#zzzzzz::shape_1")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("")).toBe(DEFAULT_BOT_AVATAR_COLOR);
  });

  it("exposes shape picker name and pressed state", () => {
    const html = renderToString(
      <BotShapePreview shapeIndex={0} color="#8B5CF6" selected onClick={() => undefined} />,
    );
    expect(html).toContain('aria-label="hex"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("focus-visible:ring-2");
  });

  it("keeps uploaded images", () => {
    const html = renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" />);
    expect(html).toContain('src="data:image/png;base64,abc"');
  });
});
