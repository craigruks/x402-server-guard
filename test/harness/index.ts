/**
 * Deterministic x402 testbed.
 *
 * A `FakeChain` (single-use nonces), a `FakeFacilitator` (x402's real
 * `FacilitatorClient`, faithfully flawed), and a naive `BaselineResourceServer`,
 * wired by `createTestbed`. Attack reproductions drive this baseline to show an
 * exploit landing; the guard (later) is shown to close it.
 */
export { BaselineResourceServer } from "./baseline-server.js";
export {
  CachingProxy,
  type FetchOutcome,
  type PaymentAttempt,
} from "./caching-proxy.js";
export { FakeChain, FINALITY_CONFIRMATIONS } from "./fake-chain.js";
export { FakeFacilitator } from "./fake-facilitator.js";
export { GuardedResourceServer } from "./guarded-server.js";
export type { PaymentOptions } from "./payment.js";
export { makePayment, newNonce, readExactEvmPayload } from "./payment.js";
export { SharedCache } from "./shared-cache.js";
export { createTestbed, type Testbed, type TestbedOptions } from "./testbed.js";
export type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  GrantResult,
  SettlementResult,
} from "./types.js";
