/**
 * Deterministic x402 testbed.
 *
 * A `FakeChain` (single-use nonces) + a `FakeFacilitator` (x402's real
 * `FacilitatorClient`, faithfully flawed) + a naive `BaselineResourceServer`.
 * Attack reproductions drive this baseline to show an exploit landing; the
 * guard (later) is shown to close it.
 */
export { BaselineResourceServer } from "./baseline-server.js";
export { FakeChain } from "./fake-chain.js";
export { FakeFacilitator } from "./fake-facilitator.js";
export type { PaymentOptions } from "./payment.js";
export { makePayment, newNonce, readExactEvmPayload } from "./payment.js";
export type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  GrantResult,
  SettlementResult,
} from "./types.js";
