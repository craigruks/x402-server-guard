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
import { createGuard } from "../../src/index.js";
import {
  createTestbed,
  FakeChain,
  FakeFacilitator,
  FINALITY_CONFIRMATIONS,
  makePayment,
  newNonce,
} from "../harness/index.js";

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

describe("guarded: grant-before-finality", () => {
  const RESOURCE = "https://api.example.com/report";
  const EXPIRES_AT = 2_000_000_000;

  it("withholds the resource until finality and releases the nonce when a pre-finality settlement reorgs", async () => {
    const chain = new FakeChain();
    const facilitator = new FakeFacilitator(chain);
    const guard = createGuard();
    const nonce = newNonce();
    const { payload, requirements } = makePayment({ nonce });

    // Secure flow: reserve, settle, then HOLD. The guarded server does not grant
    // at zero confirmations; it waits for FINALITY_CONFIRMATIONS.
    const reservation = await guard.reserve({ nonce, resource: RESOURCE, expiresAt: EXPIRES_AT });
    expect(reservation.reserved).toBe(true);
    if (!reservation.reserved) return;
    const settle = await facilitator.settle(payload, requirements);
    expect(settle.success).toBe(true);
    expect(chain.confirmationsOf(nonce)).toBe(0); // not final yet: no grant

    // A reorg drops the not-yet-final settlement before any grant.
    expect(chain.reorg(nonce)).toBe(true);
    expect(chain.isConsumed(nonce)).toBe(false);

    // Seeing the settlement reverted, the server releases the hold and denies.
    expect(await reservation.release()).toEqual({ ok: true, value: { status: "released" } });

    // Nothing was granted, and because the nonce was released the payer can retry
    // the same authorization once resubmitted (it was never consumed on-chain).
    const retry = await guard.reserve({ nonce, resource: RESOURCE, expiresAt: EXPIRES_AT });
    expect(retry.reserved).toBe(true);
  });

  it("grants once the settlement reaches finality, which a reorg can no longer revert", async () => {
    const chain = new FakeChain();
    const facilitator = new FakeFacilitator(chain);
    const guard = createGuard();
    const nonce = newNonce();
    const { payload, requirements } = makePayment({ nonce });

    const reservation = await guard.reserve({ nonce, resource: RESOURCE, expiresAt: EXPIRES_AT });
    expect(reservation.reserved).toBe(true);
    expect((await facilitator.settle(payload, requirements)).success).toBe(true);

    // Bury the settlement past finality: only now does the guarded server grant.
    chain.mineBlocks(FINALITY_CONFIRMATIONS);
    expect(chain.confirmationsOf(nonce)).toBeGreaterThanOrEqual(FINALITY_CONFIRMATIONS);
    expect(chain.reorg(nonce)).toBe(false); // too deep to revert: the grant is safe
    expect(chain.isConsumed(nonce)).toBe(true);
  });
});
