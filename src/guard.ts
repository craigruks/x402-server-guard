/**
 * The guard: server-side x402 hardening as decisions, not exceptions.
 *
 * A merchant reserves a payment's nonce before granting the resource, so a replay, a
 * concurrent race, or a cross-resource substitution is denied. The decision is a value
 * (`Reservation`), never a throw, so a stray `try/catch` cannot turn a deny into an
 * accidental grant; a store failure fails closed (denies, never grants). The attack
 * narratives are in the docs site; this is the framework-agnostic core.
 */
import { canonicalNonce, canonicalResource } from "./canonical.js";
import { type GuardError, guardError } from "./error.js";
import {
  createMemoryNonceStore,
  type NonceStore,
  type ReleaseOutcome,
  type ReserveParams,
  type StoreError,
} from "./nonce-store.js";
import { err, type Result, tryCatchAsync } from "./result.js";

/** The deny reasons a reservation can carry. */
export type GuardErrorCode =
  | "nonce-already-reserved"
  | "nonce-resource-mismatch"
  | "nonce-expired"
  | "store-unavailable"
  | "store-at-capacity";

export interface GuardOptions {
  /** Where reserved nonces are tracked. Defaults to an in-memory store. */
  store?: NonceStore;
  /**
   * Fold a nonce to a canonical key before it is reserved, so two encodings of one
   * nonce cannot become two grants. Defaults to {@link canonicalNonce}. Pass the
   * identity `(n) => n` to opt out and key on the exact bytes.
   */
  canonicalizeNonce?: (nonce: string) => string;
  /**
   * Fold the resource to a canonical key before it is bound. Defaults to
   * {@link canonicalResource}. Pass the identity `(r) => r` to opt out.
   */
  canonicalizeResource?: (resource: string) => string;
}

/**
 * A guard decision: reserved (grant may proceed) or denied with a typed reason.
 *
 * The reserved handle carries `release`, to free the nonce if the payment does not go
 * through so the payer can retry the same authorization. The fencing token that
 * authorizes the release is held inside the handle, never exposed. Not calling
 * `release` is safe: the reservation expires with the authorization.
 */
export type Reservation =
  | { readonly reserved: true; release(): Promise<Result<ReleaseOutcome, StoreError>> }
  | { readonly reserved: false; readonly reason: GuardError<GuardErrorCode> };

export interface Guard {
  /**
   * Reserve a payment's nonce before granting. The first caller for a nonce is
   * reserved; any later caller (replay or concurrent race) is denied. A store
   * failure denies (fail closed).
   */
  reserve(params: ReserveParams): Promise<Reservation>;
}

/** Create a guard backed by an in-memory nonce store (or a supplied one). */
export function createGuard(options: GuardOptions = {}): Guard {
  const store = options.store ?? createMemoryNonceStore();
  const canonicalizeNonce = options.canonicalizeNonce ?? canonicalNonce;
  const canonicalizeResource = options.canonicalizeResource ?? canonicalResource;
  return {
    async reserve(params: ReserveParams): Promise<Reservation> {
      // Fold both keys to canonical form up front; everything below is keyed on the
      // canonical values (see canonical.ts for why two encodings must not split).
      const nonce = canonicalizeNonce(params.nonce);
      const resource = canonicalizeResource(params.resource);
      const result = await callStore(() =>
        store.reserve({ nonce, resource, expiresAt: params.expiresAt }),
      );
      if (!result.ok) {
        // callStore already mapped throws to store-unavailable; surface a known store
        // code as-is, but collapse an unrecognized one (a misbehaving adapter) to
        // store-unavailable so it still fails closed.
        const error = result.error;
        const reason =
          error.code === "store-at-capacity" || error.code === "store-unavailable"
            ? error
            : guardError("store-unavailable", "nonce store unavailable", error);
        return { reserved: false, reason };
      }
      switch (result.value.status) {
        case "reserved": {
          const { token } = result.value;
          return { reserved: true, release: () => releaseReservation(store, nonce, token) };
        }
        case "already-reserved":
          // Nonce taken. If first bound to a DIFFERENT resource this is a
          // cross-resource substitution, not a replay: report it distinctly. Both
          // sides are canonical keys (boundResource was stored canonical).
          if (result.value.boundResource !== resource) {
            return {
              reserved: false,
              reason: guardError(
                "nonce-resource-mismatch",
                "payment nonce is bound to a different resource",
              ),
            };
          }
          return {
            reserved: false,
            reason: guardError("nonce-already-reserved", "payment nonce is already reserved"),
          };
        case "expired":
          return {
            reserved: false,
            reason: guardError("nonce-expired", "payment authorization has expired"),
          };
        default:
          // Defensive: an off-contract status fails closed here rather than falling
          // through to an undefined return (a throw).
          return {
            reserved: false,
            reason: guardError("store-unavailable", "nonce store returned an unknown status"),
          };
      }
    },
  };
}

/**
 * Run a store op with the fail-closed guarantee in one place: a store that THROWS or
 * REJECTS becomes a `store-unavailable` value rather than an uncaught rejection, so
 * fail-closed does not depend on each adapter author. A returned error value is passed
 * through for the caller to map.
 */
async function callStore<T, E extends GuardError>(
  op: () => Promise<Result<T, E>>,
): Promise<Result<T, E | StoreError>> {
  const outcome = await tryCatchAsync(op);
  if (!outcome.ok) {
    return err(guardError("store-unavailable", "nonce store unavailable", outcome.error));
  }
  return outcome.value;
}

/** Release a reservation through the store, mapping a store throw to a fail-closed error. */
function releaseReservation(
  store: NonceStore,
  nonce: string,
  token: string,
): Promise<Result<ReleaseOutcome, StoreError>> {
  return callStore(() => store.release(nonce, token));
}
