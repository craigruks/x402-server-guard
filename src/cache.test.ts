import { describe, expect, it } from "vitest";
import { isStorableBySharedCache, paidResponseCacheDirectives } from "./cache.js";

describe("paidResponseCacheDirectives", () => {
  it("marks a paid response no-store and private", () => {
    const directives = paidResponseCacheDirectives();
    expect(directives.cacheControl).toBe("no-store, private");
    expect(directives.vary).toBe("X-PAYMENT");
  });

  it("varies on a custom payment header", () => {
    expect(paidResponseCacheDirectives({ paymentHeader: "PAYMENT" }).vary).toBe("PAYMENT");
  });
});

describe("isStorableBySharedCache", () => {
  it("treats a missing or empty Cache-Control as storable", () => {
    expect(isStorableBySharedCache(undefined)).toBe(true);
    expect(isStorableBySharedCache("")).toBe(true);
    expect(isStorableBySharedCache("public, max-age=60")).toBe(true);
  });

  it("refuses to store no-store or private responses (case-insensitive)", () => {
    expect(isStorableBySharedCache("no-store, private")).toBe(false);
    expect(isStorableBySharedCache("No-Store")).toBe(false);
    expect(isStorableBySharedCache("private")).toBe(false);
  });
});
