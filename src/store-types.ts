/**
 * The nonce store contract: the shape every store implements.
 *
 * Kept free of any runtime import (no `node:crypto`, no Node globals) so a
 * non-Node adapter (a Cloudflare Durable Object, Deno, an edge runtime) can import
 * the contract without dragging Node built-ins into its build. The in-memory store
 * and its Node-specific bits live in `nonce-store.ts`, which re-exports these.
 */
import type { GuardError } from "./error.js";
import type { Result } from "./result.js";

/**
 * The outcome of a reserve. `reserved` carries a fencing `token`: only its holder can
 * later `release`, so releasing an in-flight hold is not a griefing primitive.
 */
export type ReserveOutcome =
  | { readonly status: "reserved"; readonly token: string }
  | { readonly status: "already-reserved"; readonly boundResource: string }
  | { readonly status: "expired" };

/** The outcome of a release. `not-held` means no matching token: nothing was freed. */
export type ReleaseOutcome = { readonly status: "released" } | { readonly status: "not-held" };

/** The only error a `release` reports, and what the guard collapses any unrecognized store failure to (fail closed). */
export type StoreError = GuardError<"store-unavailable">;

/** What a `reserve` can report: a `StoreError`, or the store being at its hard `maxEntries` capacity. Branch on `code`. */
export type ReserveError = StoreError | GuardError<"store-at-capacity">;

export interface ReserveParams {
  /**
   * The payment's nonce, unique within its (chain, asset, payer) scope; the x402 exact
   * scheme uses a random 32-byte value. The guard folds this to a canonical key by
   * default (canonical.ts); a direct store caller must pre-fold it.
   */
  readonly nonce: string;
  /**
   * The resource this payment is spent on, as a canonical key. Substitution compares
   * this to the resource the nonce first bound to, so equal resources must produce an
   * equal string. The guard canonicalizes URL casing by default.
   */
  readonly resource: string;
  /**
   * Unix seconds, the authorization's `validBefore`. Used two ways: `reserve` refuses
   * an authorization whose window has closed (`expiresAt <= now`), and past this time a
   * live reservation may be evicted (unreplayable on-chain, so dropping it is lossless).
   */
  readonly expiresAt: number;
}

/** A store of reserved payment nonces. `reserve` must be atomic. */
export interface NonceStore {
  reserve(params: ReserveParams): Promise<Result<ReserveOutcome, ReserveError>>;
  /**
   * Release a reservation so the nonce can be reserved again (e.g. after a failed or
   * reorged settlement, so a legitimate payer can retry). Releases only if `token`
   * matches the one `reserve` returned (fencing); otherwise frees nothing (`not-held`).
   */
  release(nonce: string, token: string): Promise<Result<ReleaseOutcome, StoreError>>;
}
