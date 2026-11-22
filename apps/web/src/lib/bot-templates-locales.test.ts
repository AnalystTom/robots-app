import { BOT_TEMPLATES } from "@robots/core";
import { describe, expect, it } from "vitest";
import { BOT_TEMPLATE_COPY } from "../components/bot-templates/bot-template-copy";

describe("bot template translations", () => {
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
