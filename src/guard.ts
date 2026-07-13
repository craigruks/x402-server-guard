/**
 * The guard: server-side x402 hardening as decisions, not exceptions.
 *
 * A merchant reserves a payment's nonce before granting the resource. The first
 * request for a nonce is allowed; a replay or a concurrent race is denied, and a
 * nonce re-presented for a different resource than it first bound to is denied as
 * a cross-resource substitution. The decision is a value (`Reservation`), never a
 * throw, so a stray `try/catch` cannot turn a deny into an accidental grant. A
 * store failure fails closed: an unavailable store denies, it never grants.
 *
 * This is the framework-agnostic core. An adapter wires it into `@x402/core`'s
 * resource-server lifecycle hooks; a hand-rolled server can call `reserve`
 * directly.
 */
import { type GuardError, guardError } from "./error.js";
import {
  createMemoryNonceStore,
  type NonceStore,
  type ReleaseOutcome,
  type ReserveParams,
} from "./nonce-store.js";
import { err, type Result, tryCatchAsync } from "./result.js";

/** The deny reasons a reservation can carry. */
export type GuardErrorCode =
  | "nonce-already-reserved"
  | "nonce-resource-mismatch"
  | "nonce-expired"
  | "store-unavailable";

export interface GuardOptions {
  /** Where reserved nonces are tracked. Defaults to an in-memory store. */
  store?: NonceStore;
}

/**
 * A guard decision: reserved (grant may proceed) or denied with a typed reason.
 *
 * The reserved handle carries `release`, to free the nonce if the payment does not
 * go through (a settlement that fails or is reorged before finality), so the payer
 * can retry the same authorization. The fencing token that authorizes the release
 * is held inside the handle, never exposed. Not calling `release` is safe: the
 * reservation simply expires with the authorization.
 */
export type Reservation =
  | { readonly reserved: true; release(): Promise<Result<ReleaseOutcome, GuardError>> }
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
  return {
    async reserve(params: ReserveParams): Promise<Reservation> {
      // Wrap the store call so a store that THROWS or REJECTS fails closed too,
      // not only one that returns `err`. A distributed adapter (Redis SET NX, a
      // Durable Object fetch) rejects on an I/O failure, which is the store
      // outage the fail-closed guarantee exists for. `tryCatchAsync` turns that
      // rejection into a value; a raw `await store.reserve(...)` would let it
      // escape as an uncaught rejection and make fail-closed framework-dependent.
      const outcome = await tryCatchAsync(() => store.reserve(params));
      if (!outcome.ok) {
        // The store threw or rejected.
        return {
          reserved: false,
          reason: guardError("store-unavailable", "nonce store unavailable", outcome.error),
        };
      }
      const result = outcome.value;
      if (!result.ok) {
        // The store returned a failure value. Fail closed: never an accidental grant.
        return {
          reserved: false,
          reason: guardError("store-unavailable", "nonce store unavailable", result.error),
        };
      }
      switch (result.value.status) {
        case "reserved": {
          const { token } = result.value;
          return { reserved: true, release: () => releaseReservation(store, params.nonce, token) };
        }
        case "already-reserved":
          // The nonce is taken. If it was first bound to a DIFFERENT resource,
          // this is a cross-resource substitution attempt, not a plain replay:
          // one payment cannot be spent across two resources. Report it distinctly
          // so the merchant can tell substitution from an ordinary retry. The
          // resource is compared as a canonical key (see ReserveParams.resource).
          if (result.value.boundResource !== params.resource) {
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
      }
    },
  };
}

/** Release a reservation through the store, mapping a store throw to a fail-closed error. */
async function releaseReservation(
  store: NonceStore,
  nonce: string,
  token: string,
): Promise<Result<ReleaseOutcome, GuardError>> {
  const outcome = await tryCatchAsync(() => store.release(nonce, token));
  if (!outcome.ok) {
    return err(guardError("store-unavailable", "nonce store unavailable", outcome.error));
  }
  return outcome.value;
}
