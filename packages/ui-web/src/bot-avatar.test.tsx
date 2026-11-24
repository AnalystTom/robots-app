import { ACTIVE_RUN_STATUSES, robotPresetValue } from "@robots/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_COLORS,
  BotAvatar,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

describe("BotAvatar", () => {
  it.each([...ACTIVE_RUN_STATUSES])("marks active run status %s as working", (status) => {
    const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
    expect(html).toContain("<svg");
    expect(html).toContain('data-working="true"');
  });

  it("keeps working attribute false when idle", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
  });

  it("renders distinct shapes for distinct bot identities", () => {
    const maya = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    const github = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="github" />);
    expect(maya).not.toEqual(github);
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
    const html = renderToString(
      <BotAvatar color={value} identity="b1" size={40} status="running" />,
    );
    expect(html).toMatch(/<img src="data:image\/svg\+xml,%3Csvg[^"]*"/);
    expect(html).toContain("width:40px;height:40px");
    expect(html).toContain('data-working="true"');
    expect(html).toContain("robots-bot-avatar-ring-working");
    expect(defaultBotAvatarValue(value)).toBe("#D9483B");
    expect(resolvePersonaColorDef("b1", value).hex).toBe("#D9483B");
  });

  it("does not draw a robot value that names an unknown part", () => {
    const html = renderToString(
      <BotAvatar color={'robot:red."><script>x</script>.grumpy.chef-jacket.none'} size={32} />,
    );
    expect(html).not.toContain("<script");
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

  it("keeps uploaded images", () => {
    const html = renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" />);
    expect(html).toContain("<img");
    expect(html).not.toContain("robots-organic-avatar");
  });

  it.each([
    ["a plain hex", "#8B5CF6"],
    ["an organic shape", "#10B981::shape_3"],
  ] as const)("draws %s as the RoBots preset its identity hashes to", (_label, color) => {
    const expected = renderToString(
      <BotAvatar color={robotPresetValue("analyst")} identity="maya" />,
    );
    const html = renderToString(<BotAvatar color={color} identity="maya" />);
    expect(html).toBe(expected);
    expect(html).toMatch(/<img src="data:image\/svg\+xml,%3Csvg/);
    expect(html).not.toContain("robots-organic-avatar");
    expect(html).not.toContain("robots-logo-avatar");
  });

  it("spreads identities over more than one preset", () => {
    const drawn = new Set(
      ["maya", "github", "stripe", "notion", "linear", "slack", "figma", "vercel"].map((identity) =>
        renderToString(<BotAvatar color="#8B5CF6" identity={identity} />),
      ),
    );
    expect(drawn.size).toBeGreaterThan(3);
  });
});
