import { describe, expect, it } from "vitest";
import { browserStoreKey, browserStoreSecret } from "./browser-store-key.js";

describe("browser store key", () => {
  it("keeps the key every existing computer was sealed with", () => {
    expect(browserStoreKey(Buffer.alloc(32, 1), "computer-a")).toBe(
      "aHPH_6H0Vxg38SDFUuLVxKSiND9tGeWbvabmf6IRyQY",
    );
  });

  it("is stable for one computer and different for another", () => {
    const first = browserStoreKey("secret", "computer-a");
    expect(browserStoreKey("secret", "computer-a")).toBe(first);
    expect(browserStoreKey("secret", "computer-b")).not.toBe(first);
    expect(browserStoreKey("other", "computer-a")).not.toBe(first);
  });

  it("derives its secret from the deployment key without exposing it", () => {
    const secret = browserStoreSecret("deployment-encryption-key");
    expect(secret).toBe("64e2647970a8cdb603bb495f41b3570b989a6adaa20da79ac39e63da512d8aff");
    expect(secret).not.toContain("deployment-encryption-key");
  });
});
