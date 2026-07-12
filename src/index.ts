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
export const VERSION: string = "0.1.0";

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
  type NonceStore,
  type ReserveOutcome,
  type ReserveParams,
} from "./nonce-store.js";
export { err, ok, type Result, tryCatch, tryCatchAsync } from "./result.js";
