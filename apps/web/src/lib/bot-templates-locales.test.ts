import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOT_TEMPLATES } from "@robots/core";
import { describe, expect, it } from "vitest";
import { BOT_TEMPLATE_COPY } from "../components/bot-templates/bot-template-copy";
import { UI_LOCALES } from "./ui-locale";

const TEMPLATE_DIR = "apps/web/src/components/bot-templates/";
const SHARED_TEMPLATE_STRINGS = ["RoBot templates", "Templates"];

const localesDir = new URL("../../../../packages/i18n/locales/", import.meta.url);
const catalog = (locale: string) =>
  readFileSync(fileURLToPath(new URL(`${locale}/messages.po`, localesDir)), "utf8")
    .split("\n\n")
    .filter((block) => !block.includes("#~"))
    .map((block) => {
      const strings = (key: "msgid" | "msgstr") => {
        const match = new RegExp(`^${key} ((?:".*"\\n?)+)`, "m").exec(block);
        return (match?.[1]?.match(/"(?:[^"\\]|\\.)*"/g) ?? [])
          .map((part) => JSON.parse(part) as string)
          .join("");
      };
      return {
        id: strings("msgid"),
        text: strings("msgstr"),
        references: (block.match(/^#: .*$/gm) ?? [])
          .flatMap((line) => line.slice(3).split(" "))
          .map((reference) => reference.replace(/:\d+$/, ""))
          .filter((reference) => reference.startsWith("apps/web/")),
      };
    })
    .filter((entry) => entry.id);

describe("bot template translations", () => {
  it("has every bot template string translated in every language", () => {
    const ids = catalog("en")
      .filter(
        (entry) =>
          (entry.references.length > 0 &&
            entry.references.every((file) => file.startsWith(TEMPLATE_DIR))) ||
          SHARED_TEMPLATE_STRINGS.includes(entry.id),
      )
      .map((entry) => entry.id);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const locale of UI_LOCALES.filter((item) => item !== "en")) {
      const texts = new Map(catalog(locale).map((entry) => [entry.id, entry.text]));
      const blank = ids.filter((id) => !texts.get(id));
      expect(blank, locale).toEqual([]);
    }
  });

  it("has web copy whose English matches the server for every template", () => {
    for (const template of BOT_TEMPLATES) {
      const copy = BOT_TEMPLATE_COPY[template.id];
      expect([copy?.name.message, copy?.summary.message], template.id).toEqual([
        template.name,
        template.summary,
      ]);
    }
  });
});
