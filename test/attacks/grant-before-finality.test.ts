/**
 * Attack reproduction: grant-before-finality (k-confirmations).
 *
 * `settle()` reporting success means the payment landed in a block, not that it
 * is final. Until it is buried under enough confirmations, a chain reorg can
 * drop it and revert the payment. The baseline grants the moment settlement
 * succeeds, at zero confirmations, so a reorg after the grant leaves the
 * resource delivered against a payment that never stuck.
 *
 * This documents the exploit against the unguarded baseline. The mitigation
 * holds the grant until the settlement reaches FINALITY_CONFIRMATIONS, at which
 * point the reorg here can no longer revert a payment the client was served on.
 *
 * How exploitable this is depends on the chain. On a single-sequencer L2 like
 * Base (x402's usual home) reorgs are rare and an attacker cannot readily force
 * one; elsewhere the risk is higher, and an attacker able to induce or exploit a
 * reorg turns bad luck into an exploit. FINALITY_CONFIRMATIONS is a stand-in: a
 * real guard's k is a per-chain setting, not the constant used here.
 */
import { describe, expect, it } from "vitest";
import { createTestbed, FINALITY_CONFIRMATIONS, makePayment, newNonce } from "../harness/index.js";

describe("attack: grant-before-finality", () => {
  it("delivers the resource against a payment a reorg then reverts", async () => {
    const { chain, server } = createTestbed();
    const nonce = newNonce();
    const { payload, requirements } = makePayment({ nonce });

    // The server grants as soon as settle() succeeds, at zero confirmations.
    const result = await server.handle(payload, requirements);
    expect(result.granted).toBe(true);
    expect(result.settlement?.ok).toBe(true);
    expect(chain.confirmationsOf(nonce)).toBe(0);
    expect(chain.settledCount).toBe(1);

    // A reorg drops the not-yet-final transaction.
    const reverted = chain.reorg(nonce);

    expect(reverted).toBe(true);
    // The payment is gone, the nonce is free again, yet the resource is already out.
    expect(chain.isConsumed(nonce)).toBe(false);
    expect(chain.settledCount).toBe(0);
    expect(chain.confirmationsOf(nonce)).toBeUndefined();
  });

  it("cannot revert a settlement that has reached finality", async () => {
    // Control: once the settlement is buried past FINALITY_CONFIRMATIONS, the
    // reorg no longer reverts it. Waiting for finality before granting is exactly
    // what the baseline skips.
    const { chain, server } = createTestbed();
    const nonce = newNonce();
    const { payload, requirements } = makePayment({ nonce });

    await server.handle(payload, requirements);
    chain.mineBlocks(FINALITY_CONFIRMATIONS);
    const reverted = chain.reorg(nonce);

    expect(reverted).toBe(false);
    expect(chain.isConsumed(nonce)).toBe(true);
    expect(chain.settledCount).toBe(1);
  });
});
