import { describe, expect, it } from "vitest";
import { appPairingLink, pairingLink, parsePairingInput } from "./device-pairing.js";

describe("pairing links", () => {
  it("keeps the code in the fragment, never the query", () => {
    const link = pairingLink("https://box.example.test/app?x=1", "ABCDEFGHJKMN");
    expect(link).toBe("https://box.example.test/pair#token=ABCDEFGHJKMN");
    expect(new URL(link).search).toBe("");
  });

  it("reads a web link, an app link, or a bare code", () => {
    const link = pairingLink("http://192.168.1.5:45173", "ABCDEFGHJKMN");
    expect(parsePairingInput(link)).toEqual({
      origin: "http://192.168.1.5:45173",
      code: "ABCDEFGHJKMN",
    });
    expect(parsePairingInput(appPairingLink(link))).toEqual(parsePairingInput(link));
    expect(parsePairingInput("abcd-efgh-jkmn")).toEqual({ code: "ABCDEFGHJKMN" });
  });

  it("refuses anything else", () => {
    expect(parsePairingInput("https://box.example.test/pair?token=ABCDEFGHJKMN")).toBeNull();
    expect(parsePairingInput("https://box.example.test/other#token=ABCDEFGHJKMN")).toBeNull();
    expect(parsePairingInput("javascript:alert(1)#token=ABCDEFGHJKMN")).toBeNull();
    expect(parsePairingInput(appPairingLink(appPairingLink("x")))).toBeNull();
    expect(parsePairingInput("hello")).toBeNull();
  });
});
