/**
 * A deterministic stand-in for on-chain EIP-3009 nonce state.
 *
 * Two security-relevant properties it models:
 *   1. A nonce is single-use. The first settlement to reach `settle()` for a
 *      given nonce wins; every later attempt fails `nonce-already-used`, exactly
 *      as the chain rejects a replayed `transferWithAuthorization`.
 *   2. Settlement is not instantly final. A fresh settlement lands at zero
 *      confirmations and can be reorged out until it is buried past
 *      `FINALITY_CONFIRMATIONS`, which reverts the payment and frees the nonce.
 *
 * `settlementLatencyMs` models block-inclusion time, the window during which a
 * read-only verify still reports the nonce as unconsumed. That window is what
 * makes the grant-before-settle race reproducible without a real chain.
 */
import { createHash } from "node:crypto";
import type { SettlementResult } from "./types.js";

/**
 * Confirmations at or past which a settlement is treated as final (unreorgable).
 * A model stand-in: real finality is chain-specific (an L2 sequencer's soft vs
 * L1-backed finality differs from PoW/PoS k-confirmations), so a guard sets this
 * per chain rather than hard-coding one number.
 */
export const FINALITY_CONFIRMATIONS = 2;

interface Settlement {
  txHash: string;
  confirmations: number;
}

export class FakeChain {
  private readonly consumed = new Set<string>();
  private readonly settlements = new Map<string, Settlement>();
  private readonly settlementLatencyMs: number;

  constructor(settlementLatencyMs = 0) {
    this.settlementLatencyMs = settlementLatencyMs;
  }

  /** Read-only check. Does not lock or consume the nonce. */
  isConsumed(nonce: string): boolean {
    return this.consumed.has(nonce);
  }

  /** How many nonces have settled on-chain and not been reorged out. */
  get settledCount(): number {
    return this.consumed.size;
  }

  /**
   * Attempt to consume a nonce after the settlement latency elapses. Atomic:
   * only the first caller for a given nonce succeeds. The settlement lands at
   * zero confirmations, not yet final.
   */
  async settle(nonce: string): Promise<SettlementResult> {
    if (this.settlementLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settlementLatencyMs));
    }
    if (this.consumed.has(nonce)) {
      return { ok: false, reason: "nonce-already-used" };
    }
    this.consumed.add(nonce);
    const txHash = `0x${createHash("sha256").update(nonce).digest("hex")}`;
    this.settlements.set(nonce, { txHash, confirmations: 0 });
    return { ok: true, txHash };
  }

  /** Confirmations for a live settlement, or undefined if none or reorged out. */
  confirmationsOf(nonce: string): number | undefined {
    return this.settlements.get(nonce)?.confirmations;
  }

  /** Advance every live settlement by n confirmations, as mining n blocks does. */
  mineBlocks(count: number): void {
    for (const settlement of this.settlements.values()) {
      settlement.confirmations += count;
    }
  }

  /**
   * Reorg out a settlement that has not reached finality, reverting the payment:
   * the nonce is freed and the settlement dropped, as if the transaction never
   * landed. A settlement at or past `FINALITY_CONFIRMATIONS` is too deep to
   * reorg and is left in place. Returns whether a revert happened.
   */
  reorg(nonce: string): boolean {
    const settlement = this.settlements.get(nonce);
    if (settlement === undefined || settlement.confirmations >= FINALITY_CONFIRMATIONS) {
      return false;
    }
    this.settlements.delete(nonce);
    this.consumed.delete(nonce);
    return true;
  }
}
