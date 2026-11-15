import { describe, expect, it } from "vitest";
import { dayPart, firstName, startOfDay, workingBotNames } from "./today-summary";

describe("today summary", () => {
  it.each([
    [0, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ] as const)("greets hour %i as %s", (hour, part) => {
    expect(dayPart(hour)).toBe(part);
  });

  it("uses the first word of the name", () => {
    expect(firstName("  Ada  Lovelace ")).toBe("Ada");
    expect(firstName("")).toBe("");
    expect(firstName(undefined)).toBe("");
  });

  it("starts the day at local midnight", () => {
    const start = new Date(startOfDay(new Date(2026, 10, 15, 16, 30)));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([
      2026, 10, 15, 0,
    ]);
    expect(start.getMinutes() + start.getSeconds() + start.getMilliseconds()).toBe(0);
  });

  it("names each working bot once", () => {
    expect(
      workingBotNames([{ botName: "Scout" }, { botName: "Helper" }, { botName: "Scout" }]),
    ).toEqual(["Scout", "Helper"]);
  });
});
