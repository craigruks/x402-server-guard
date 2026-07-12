/**
 * A deterministic stand-in for on-chain EIP-3009 nonce state.
 *
 * The only security-relevant property it models: a nonce is single-use. The
 * first settlement to reach `settle()` for a given nonce wins; every later
 * attempt fails with `nonce-already-used`, exactly as the chain rejects a
 * replayed `transferWithAuthorization`.
 *
 * `settlementLatencyMs` models block-inclusion time, the window during which a
 * read-only verify still reports the nonce as unconsumed. That window is what
 * makes the grant-before-settle race reproducible without a real chain.
 */
import { createHash } from "node:crypto";
import type { SettlementResult } from "./types.js";

export class FakeChain {
  private readonly consumed = new Set<string>();
  private readonly settlementLatencyMs: number;

  constructor(settlementLatencyMs = 0) {
    this.settlementLatencyMs = settlementLatencyMs;
  }

  /** Read-only check. Does not lock or consume the nonce. */
  isConsumed(nonce: string): boolean {
    return this.consumed.has(nonce);
  }

  /** How many nonces have settled on-chain (i.e. real payments). */
  get settledCount(): number {
    return this.consumed.size;
  }

  /**
   * Attempt to consume a nonce after the settlement latency elapses. Atomic:
   * only the first caller for a given nonce succeeds.
   */
  async settle(nonce: string): Promise<SettlementResult> {
    if (this.settlementLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settlementLatencyMs));
    }
    if (this.consumed.has(nonce)) {
      return { ok: false, reason: "nonce-already-used" };
    }
    this.consumed.add(nonce);
    return { ok: true, txHash: `0x${createHash("sha256").update(nonce).digest("hex")}` };
  }
}
