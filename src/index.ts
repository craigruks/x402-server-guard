/**
 * @craigruks/x402-server-guard
 *
 * Server-side hardening middleware for x402 payment endpoints.
 *
 * SECURITY DISCLAIMER: This software is provided "AS IS", without warranty of
 * any kind. It is NOT audited and is NOT a security guarantee. It mitigates
 * specific, enumerated attack classes only. It cannot make an insecure payment
 * endpoint safe on its own. See SECURITY.md for scope and reporting.
 *
 * Status: v0.1, in progress. The nonce reservation that stops the settlement
 * race and payment replay is the first mitigation to land.
 */

/** Current package version (semver). */
export const VERSION: string = "0.1.1";

export {
  type CacheDirectives,
  type CacheDirectivesOptions,
  isStorableBySharedCache,
  paidResponseCacheDirectives,
} from "./cache.js";
export { canonicalNonce, canonicalResource } from "./canonical.js";
export { type GuardError, guardError } from "./error.js";
export {
  createGuard,
  type Guard,
  type GuardErrorCode,
  type GuardOptions,
  type Reservation,
} from "./guard.js";
export {
  createMemoryNonceStore,
  type MemoryNonceStoreOptions,
  type NonceStore,
  type ReleaseOutcome,
  type ReserveError,
  type ReserveOutcome,
  type ReserveParams,
  type StoreError,
} from "./nonce-store.js";
export {
  type ProtectDecision,
  type ProtectDenyReason,
  type ProtectHandlers,
  protect,
} from "./protect.js";
export { err, ok, type Result, tryCatch, tryCatchAsync } from "./result.js";
