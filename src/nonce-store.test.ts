import { describe, expect, it } from "vitest";
import { MemoryNonceStore } from "./nonce-store.js";

describe("MemoryNonceStore", () => {
  it("reserves a fresh nonce", async () => {
    const store = new MemoryNonceStore();
    const outcome = await store.reserve({ nonce: "0xabc", resource: "/r" });
    expect(outcome.status).toBe("reserved");
  });

  it("denies a second reserve of the same nonce", async () => {
    const store = new MemoryNonceStore();
    await store.reserve({ nonce: "0xabc", resource: "/r" });
    const outcome = await store.reserve({ nonce: "0xabc", resource: "/r" });
    expect(outcome.status).toBe("already-reserved");
  });

  it("reserves distinct nonces independently", async () => {
    const store = new MemoryNonceStore();
    const a = await store.reserve({ nonce: "0xa", resource: "/r" });
    const b = await store.reserve({ nonce: "0xb", resource: "/r" });
    expect(a.status).toBe("reserved");
    expect(b.status).toBe("reserved");
  });

  it("is atomic: only one of N concurrent reserves of one nonce wins", async () => {
    const store = new MemoryNonceStore();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => store.reserve({ nonce: "0xrace", resource: "/r" })),
    );
    const reserved = outcomes.filter((o) => o.status === "reserved").length;
    expect(reserved).toBe(1);
  });
});
