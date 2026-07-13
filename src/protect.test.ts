import { describe, expect, it, vi } from "vitest";
import { createGuard } from "./guard.js";
import { type ProtectHandlers, protect } from "./protect.js";

const request = (nonce: string, resource = "/report") => ({
  nonce,
  resource,
  expiresAt: 2_000_000_000,
});

describe("protect", () => {
  it("grants when the payment reserves and settles, returning cache directives", async () => {
    const guard = createGuard();
    const decision = await protect(guard, request("0xa"), {
      settle: () => Promise.resolve(true),
      deliver: () => "the-resource",
      finality: "facilitator",
    });
    expect(decision.granted).toBe(true);
    if (decision.granted) {
      expect(decision.resource).toBe("the-resource");
      expect(decision.cacheControl).toBe("no-store, private");
    }
  });

  it("denies a replay before settling and never delivers", async () => {
    const guard = createGuard();
    await protect(guard, request("0xa"), {
      settle: () => Promise.resolve(true),
      deliver: () => "first",
      finality: "facilitator",
    });
    const settle = vi.fn(() => Promise.resolve(true));
    const deliver = vi.fn(() => "second");
    const decision = await protect(guard, request("0xa"), {
      settle,
      deliver,
      finality: "facilitator",
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("nonce-already-reserved");
    }
    expect(settle).not.toHaveBeenCalled(); // denied before settling
    expect(deliver).not.toHaveBeenCalled();
  });

  it("denies substitution: a nonce bound to one resource is refused at another", async () => {
    const guard = createGuard();
    await protect(guard, request("0xa", "/report-A"), {
      settle: () => Promise.resolve(true),
      deliver: () => "A",
      finality: "facilitator",
    });
    const decision = await protect(guard, request("0xa", "/report-B"), {
      settle: () => Promise.resolve(true),
      deliver: () => "B",
      finality: "facilitator",
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("nonce-resource-mismatch");
    }
  });

  it("releases the nonce and denies when settle fails, allowing a retry", async () => {
    const guard = createGuard();
    const failed = await protect(guard, request("0xa"), {
      settle: () => Promise.resolve(false),
      deliver: () => "never",
      finality: "facilitator",
    });
    expect(failed.granted).toBe(false);
    if (!failed.granted) {
      expect(failed.reason.code).toBe("settle-failed");
    }
    // The nonce was released: the same authorization reserves and grants on retry.
    const retry = await protect(guard, request("0xa"), {
      settle: () => Promise.resolve(true),
      deliver: () => "retry",
      finality: "facilitator",
    });
    expect(retry.granted).toBe(true);
  });

  it("treats a throwing settle as a failed settle: releases, denies, retryable, no delivery", async () => {
    const guard = createGuard();
    const deliver = vi.fn(() => "never");
    const decision = await protect(guard, request("0xa"), {
      settle: () => Promise.reject(new Error("facilitator timeout")),
      deliver,
      finality: "facilitator",
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("settle-failed");
    }
    expect(deliver).not.toHaveBeenCalled();
    // A thrown settle must still release the nonce so the same payment can retry.
    const retry = await protect(guard, request("0xa"), {
      settle: () => Promise.resolve(true),
      deliver: () => "retry",
      finality: "facilitator",
    });
    expect(retry.granted).toBe(true);
  });

  it("treats a throwing confirm as not-final: releases, denies, retryable, no delivery", async () => {
    const guard = createGuard();
    const deliver = vi.fn(() => "never");
    const decision = await protect(guard, request("0xz"), {
      settle: () => Promise.resolve(true),
      finality: "confirm",
      confirm: () => Promise.reject(new Error("rpc error")),
      deliver,
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("not-final");
    }
    expect(deliver).not.toHaveBeenCalled();
    const retry = await protect(guard, request("0xz"), {
      settle: () => Promise.resolve(true),
      finality: "confirm",
      confirm: () => Promise.resolve(true),
      deliver: () => "retry",
    });
    expect(retry.granted).toBe(true);
  });

  it("grants only when the finality gate is met", async () => {
    const guard = createGuard();
    const decision = await protect(guard, request("0xok"), {
      settle: () => Promise.resolve(true),
      finality: "confirm",
      confirm: () => Promise.resolve(true),
      deliver: () => "final",
    });
    expect(decision.granted).toBe(true);
  });

  it("releases and denies when the finality gate is not met (reorg), allowing a retry", async () => {
    const guard = createGuard();
    const deliver = vi.fn(() => "never");
    const decision = await protect(guard, request("0xz"), {
      settle: () => Promise.resolve(true),
      finality: "confirm",
      confirm: () => Promise.resolve(false),
      deliver,
    });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("not-final");
    }
    expect(deliver).not.toHaveBeenCalled();
    // Released: retryable.
    const retry = await protect(guard, request("0xz"), {
      settle: () => Promise.resolve(true),
      finality: "confirm",
      confirm: () => Promise.resolve(true),
      deliver: () => "retry",
    });
    expect(retry.granted).toBe(true);
  });

  it("fails closed when finality is missing (a non-TypeScript caller), not a zero-conf grant", async () => {
    const guard = createGuard();
    const deliver = vi.fn(() => "leak");
    // A JS caller (or a cast/any-typed one) that supplies settle and deliver but
    // omits `finality`. The type union forbids this, but the runtime must not grant
    // at zero confirmations: only an explicit "facilitator" grants on settle.
    const handlers = {
      settle: () => Promise.resolve(true),
      deliver,
    } as unknown as ProtectHandlers<string>;
    const decision = await protect(guard, request("0xjs"), handlers);
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason.code).toBe("not-final");
    }
    expect(deliver).not.toHaveBeenCalled();
  });
});
