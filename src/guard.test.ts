import { describe, expect, it } from "vitest";
import { guardError } from "./error.js";
import { createGuard } from "./guard.js";
import { createMemoryNonceStore, type NonceStore } from "./nonce-store.js";
import { err } from "./result.js";

const params = (nonce: string) => ({ nonce, resource: "/r", expiresAt: 2_000_000_000 });

describe("createGuard reserve", () => {
  it("reserves a fresh payment nonce", async () => {
    const guard = createGuard();
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(true);
  });

  it("denies a replay with a typed reason", async () => {
    const guard = createGuard();
    await guard.reserve(params("0xabc"));
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-already-reserved");
    }
  });

  it("denies a nonce re-presented for a different resource as a substitution", async () => {
    const guard = createGuard();
    await guard.reserve({ nonce: "0xabc", resource: "/report-A", expiresAt: 2_000_000_000 });
    // Same nonce, different resource: cross-resource substitution, not a replay.
    const decision = await guard.reserve({
      nonce: "0xabc",
      resource: "/report-B",
      expiresAt: 2_000_000_000,
    });
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-resource-mismatch");
    }
  });

  it("denies a same-resource re-presentation as a replay, not a substitution", async () => {
    const guard = createGuard();
    await guard.reserve({ nonce: "0xabc", resource: "/report-A", expiresAt: 2_000_000_000 });
    const decision = await guard.reserve({
      nonce: "0xabc",
      resource: "/report-A",
      expiresAt: 2_000_000_000,
    });
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-already-reserved");
    }
  });

  it("grants exactly one of N concurrent reservations of one nonce", async () => {
    const guard = createGuard();
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => guard.reserve(params("0xrace"))),
    );
    expect(decisions.filter((d) => d.reserved).length).toBe(1);
  });

  it("denies an already-expired authorization", async () => {
    // Clock fixed at 1000; the authorization's window closed at 500.
    const guard = createGuard({ store: createMemoryNonceStore(() => 1000) });
    const decision = await guard.reserve({ nonce: "0xexp", resource: "/r", expiresAt: 500 });
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-expired");
    }
  });

  it("fails closed when the store errors", async () => {
    const original = guardError("store-down", "boom");
    const failing: NonceStore = {
      reserve: () => Promise.resolve(err(original)),
    };
    const guard = createGuard({ store: failing });
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-unavailable");
      expect(decision.reason.cause).toBe(original);
    }
  });

  it("fails closed when the store throws or rejects", async () => {
    // A distributed adapter (Redis, a Durable Object) rejects on an I/O failure
    // rather than returning `err`. The guard must still deny, not let it escape.
    const boom = new Error("redis connection refused");
    const throwing: NonceStore = {
      reserve: () => Promise.reject(boom),
    };
    const guard = createGuard({ store: throwing });
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-unavailable");
      expect(decision.reason.cause).toBe(boom);
    }
  });
});
