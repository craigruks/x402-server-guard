import { describe, expect, it } from "vitest";
import { guardError } from "./error.js";
import { createGuard } from "./guard.js";
import { createMemoryNonceStore, type NonceStore } from "./nonce-store.js";
import { err, ok } from "./result.js";

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
    const guard = createGuard({ store: createMemoryNonceStore({ now: () => 1000 }) });
    const decision = await guard.reserve({ nonce: "0xexp", resource: "/r", expiresAt: 500 });
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("nonce-expired");
    }
  });

  it("frees the nonce through the reservation's release handle", async () => {
    const guard = createGuard();
    const first = await guard.reserve(params("0xrel"));
    expect(first.reserved).toBe(true);
    if (!first.reserved) return;

    const released = await first.release();
    expect(released).toEqual({ ok: true, value: { status: "released" } });

    // Released: the same nonce reserves again (a legit retry after a failed settle).
    const second = await guard.reserve(params("0xrel"));
    expect(second.reserved).toBe(true);
  });

  it("release fails closed when the store throws", async () => {
    const boom = new Error("redis down on release");
    const throwing: NonceStore = {
      reserve: () => Promise.resolve(ok({ status: "reserved" as const, token: "t" })),
      release: () => Promise.reject(boom),
    };
    const guard = createGuard({ store: throwing });
    const reservation = await guard.reserve(params("0xz"));
    expect(reservation.reserved).toBe(true);
    if (!reservation.reserved) return;

    const released = await reservation.release();
    expect(released).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "store-unavailable" }),
    });
  });

  it("collapses an unrecognized store error to store-unavailable (fail closed)", async () => {
    // A store returning an off-contract code (violating the NonceStore error type)
    // must still fail closed. The cast simulates such a misbehaving adapter; the
    // guard collapses anything it does not recognize to store-unavailable.
    const original = guardError("store-down", "boom");
    const failing = {
      reserve: () => Promise.resolve(err(original)),
      release: () => Promise.resolve(ok({ status: "released" as const })),
    } as unknown as NonceStore;
    const guard = createGuard({ store: failing });
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-unavailable");
      expect(decision.reason.cause).toBe(original);
    }
  });

  it("surfaces store-at-capacity as its own reason (backpressure, not an outage)", async () => {
    // A cap of 1: the second distinct nonce cannot get a slot. The guard forwards
    // store-at-capacity rather than collapsing it, so a caller can tell a full
    // store (retry later) from a down one.
    const guard = createGuard({
      store: createMemoryNonceStore({ now: () => 1000, maxEntries: 1 }),
    });
    expect((await guard.reserve(params("0xa"))).reserved).toBe(true);
    const decision = await guard.reserve(params("0xb"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-at-capacity");
    }
  });

  it("fails closed when the store throws or rejects", async () => {
    // A distributed adapter (Redis, a Durable Object) rejects on an I/O failure
    // rather than returning `err`. The guard must still deny, not let it escape.
    const boom = new Error("redis connection refused");
    const throwing: NonceStore = {
      reserve: () => Promise.reject(boom),
      release: () => Promise.reject(boom),
    };
    const guard = createGuard({ store: throwing });
    const decision = await guard.reserve(params("0xabc"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-unavailable");
      expect(decision.reason.cause).toBe(boom);
    }
  });

  it("fails closed on an off-contract store status instead of returning undefined", async () => {
    // A misbehaving adapter returns a status outside the ReserveOutcome contract.
    // The guard must deny (a value), not fall through to an undefined return that
    // would throw out of the request path.
    const misbehaving = {
      reserve: () => Promise.resolve(ok({ status: "teleported" as const })),
      release: () => Promise.resolve(ok({ status: "released" as const })),
    } as unknown as NonceStore;
    const guard = createGuard({ store: misbehaving });
    const decision = await guard.reserve(params("0xweird"));
    expect(decision.reserved).toBe(false);
    if (!decision.reserved) {
      expect(decision.reason.code).toBe("store-unavailable");
    }
  });
});
