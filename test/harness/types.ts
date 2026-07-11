/**
 * Local types for the deterministic x402 testbed.
 *
 * These model the exact-EVM (EIP-3009) payment shape that rides inside an x402
 * `PaymentPayload.payload` (which the protocol types as `Record<string, unknown>`),
 * plus the result shapes the fake chain and baseline server return.
 */

/** The EIP-3009 `transferWithAuthorization` tuple carried in an exact-EVM payment. */
export interface ExactEvmAuthorization {
  from: string;
  to: string;
  /** Authorized value, atomic token units, decimal string. */
  value: string;
  validAfter: string;
  validBefore: string;
  /** 32-byte random nonce, `0x`-prefixed hex. Single-use on-chain. */
  nonce: string;
}

/** The scheme-specific body of an exact-EVM `PaymentPayload.payload`. */
export interface ExactEvmPayload {
  signature: string;
  authorization: ExactEvmAuthorization;
}

/** Result of attempting to consume a nonce on the fake chain. */
export type SettlementResult =
  | { ok: true; txHash: string }
  | { ok: false; reason: "nonce-already-used" };

/** What the baseline resource server returns for one request. */
export interface GrantResult<TResource> {
  /** Whether the server released the resource to the caller. */
  granted: boolean;
  /** The delivered resource, present iff `granted`. */
  resource?: TResource;
  /** The settlement outcome, present iff the server attempted settlement. */
  settlement?: SettlementResult;
}
