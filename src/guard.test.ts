import { describe, expect, it } from "vitest";
import { createGuard } from "./guard.js";

describe("createGuard reserve", () => {
  it("reserves a fresh payment nonce", async () => {
    const guard = createGuard();
    const decision = await guard.reserve({ nonce: "0xabc", resource: "/r" });
    expect(decision.reserved).toBe(true);
  });

  it("denies a replay with a typed reason", async () => {
    const guard = createGuard();
    await guard.reserve({ nonce: "0xabc", resource: "/r" });
    const decision = await guard.reserve({ nonce: "0xabc", resource: "/r" });
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-already-reserved");
    }
  });

  it("grants exactly one of N concurrent reservations of one nonce", async () => {
    const guard = createGuard();
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => guard.reserve({ nonce: "0xrace", resource: "/r" })),
    );
    expect(decisions.filter((d) => d.reserved).length).toBe(1);
  });
});
