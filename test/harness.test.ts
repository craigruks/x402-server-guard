/**
 * Smoke tests for the testbed itself. They prove the harness models the x402
 * happy path faithfully before any attack builds on it.
 */
import { describe, expect, it } from "vitest";
import { createTestbed, makePayment } from "./harness/index.js";

describe("testbed harness", () => {
  it("grants and settles a single valid payment exactly once", async () => {
    const { chain, server } = createTestbed();
    const { payload, requirements } = makePayment();

    const result = await server.handle(payload, requirements);

    expect(result.granted).toBe(true);
    expect(result.resource).toBe("the-resource");
    expect(result.settlement).toEqual({ ok: true, txHash: expect.any(String) });
    expect(chain.settledCount).toBe(1);
  });

  it("rejects a sequential reuse of the same payment (nonce consumed on-chain)", async () => {
    const { chain, server } = createTestbed();
    const { payload, requirements } = makePayment();

    await server.handle(payload, requirements);
    const replay = await server.handle(payload, requirements);

    // Once settlement has consumed the nonce, a later verify sees it and denies.
    expect(replay.granted).toBe(false);
    expect(chain.settledCount).toBe(1);
  });

  it("verifies distinct payments independently", async () => {
    const { facilitator } = createTestbed();
    const first = makePayment();
    const second = makePayment();

    const a = await facilitator.verify(first.payload, first.requirements);
    const b = await facilitator.verify(second.payload, second.requirements);

    expect(a.isValid).toBe(true);
    expect(b.isValid).toBe(true);
  });

  it("denies a payload that is not a well-formed exact-EVM payment", async () => {
    const { facilitator } = createTestbed();
    const { payload, requirements } = makePayment();
    const malformed = { ...payload, payload: { not: "a payment" } };

    const verdict = await facilitator.verify(malformed, requirements);

    expect(verdict.isValid).toBe(false);
    expect(verdict.invalidReason).toBe("malformed-payment");
  });
});
