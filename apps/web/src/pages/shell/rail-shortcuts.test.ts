import { describe, expect, it } from "vitest";
import { railShortcutDigit, railShortcutLabel } from "./rail-shortcuts";

const press = (
  code: string,
  keys: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>,
) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
});

describe("rail shortcuts", () => {
  it("labels with ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(railShortcutLabel(2, true)).toBe("⌘2");
    expect(railShortcutLabel(2, false)).toBe("Ctrl 2");
  });

  it("reads Cmd+1..9 on a Mac and Ctrl+1..9 elsewhere, and nothing else", () => {
    expect(railShortcutDigit(press("Digit3", { metaKey: true }), true)).toBe(3);
    expect(railShortcutDigit(press("Numpad9", { metaKey: true }), true)).toBe(9);
    expect(railShortcutDigit(press("Digit3", { ctrlKey: true }), true)).toBeNull();
    expect(railShortcutDigit(press("Digit3", { ctrlKey: true }), false)).toBe(3);
    expect(railShortcutDigit(press("Digit0", { ctrlKey: true }), false)).toBeNull();
    expect(railShortcutDigit(press("Digit3", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(railShortcutDigit(press("KeyC", { metaKey: true }), true)).toBeNull();
  });
});
