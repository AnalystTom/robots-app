import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_SKILLS, ROBOTS_DOCS_URLS } from "./builtin-skills.js";

const docsFile = (slug: string) => new URL(`../../../docs/${slug}.md`, import.meta.url);
const publishedDocSlug = (url: string) =>
  /^https:\/\/tryrobots\.app\/docs\/([\w-]+)\.md$/.exec(url)?.[1];

describe("RoBots skill", () => {
  it("links only to published docs pages", () => {
    const skill = BUILTIN_AGENT_SKILLS.find((s) => s.name === "RoBots")!;
    const urls = [...skill.content.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
    expect(urls).toEqual(ROBOTS_DOCS_URLS);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const slug = publishedDocSlug(url);
      expect(slug, url).toBeDefined();
      expect(existsSync(docsFile(slug!)), url).toBe(true);
    }
  });
});
