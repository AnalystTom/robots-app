import { describe, expect, it } from "vitest";
import { modelTiers } from "./model-tiers.js";

const model = (id: string, label: string, price: number, provider = "vendor") => ({
  provider,
  id,
  label,
  price,
});

describe("modelTiers", () => {
  it("ranks the newest model of each family in the latest generation by price", () => {
    const tiers = modelTiers([
      model("small-4", "Small 4", 1),
      model("small-5", "Small 5.5", 0.5),
      model("mid-5", "Mid 5", 12),
      model("mid-5-5", "Mid 5.5", 10),
      model("big-5", "Big 5.5", 30),
      model("huge-5", "Huge 5.1", 60),
      model("ancient-pro-4", "Ancient Pro 4", 900),
    ]);
    expect(Object.fromEntries(tiers)).toEqual({
      "vendor:small-5": "lite",
      "vendor:mid-5-5": "auto",
      "vendor:huge-5": "pro",
    });
  });

  it("keeps tiers per provider and gives a single family only Auto", () => {
    const tiers = modelTiers([
      model("one-4.7", "One 4.7", 8, "a"),
      model("one-4.6", "One 4.6", 8, "a"),
      model("lite-2", "Name-2 Lite", 1, "b"),
      model("max-2", "Name-2 Max", 9, "b"),
    ]);
    expect(Object.fromEntries(tiers)).toEqual({
      "a:one-4.7": "auto",
      "b:lite-2": "auto",
      "b:max-2": "pro",
    });
  });

  it("ignores free, unversioned and date-stamped models", () => {
    expect(
      modelTiers([
        model("free-3", "Free 3", 0),
        model("plain", "Plain", 5),
        model("dated", "Dated 2508", 5),
        model("dated-paren", "Thing (Apr-21-2026)", 5),
      ]).size,
    ).toBe(0);
  });

  it("prefers the undated alias of a release over its snapshot", () => {
    const tiers = modelTiers([
      model("mid-4-5-20250929", "Mid 4.5", 3),
      model("mid-4-5", "Mid 4.5 (latest)", 3),
    ]);
    expect([...tiers.keys()]).toEqual(["vendor:mid-4-5"]);
  });
});
