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
  return {
    async reserve(params: ReserveParams): Promise<Reservation> {
      const result = await callStore(() => store.reserve(params));
      if (!result.ok) {
        // callStore already reduced a thrown/rejected store to `store-unavailable`.
        // Surface the recognized store codes as-is (`store-at-capacity` so a caller
        // can tell backpressure from an outage, `store-unavailable` with its cause
        // intact); collapse anything unrecognized to a fail-closed store-unavailable.
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
        default:
          // The status union is exhaustive, so this is unreachable for a conformant
          // store. A misbehaving adapter returning an off-contract status must still
          // fail closed here, not fall through to an undefined return that would
          // throw out of the guard and break the "a decision is a value" invariant.
          return {
            reserved: false,
            reason: guardError("store-unavailable", "nonce store returned an unknown status"),
          };
      }
    },
  };
}

/**
 * Call a store operation with the fail-closed guarantee in one place. A store that
 * THROWS or REJECTS (a distributed adapter rejects on an I/O outage) becomes a
 * `store-unavailable` value rather than escaping as an uncaught rejection, so
 * fail-closed does not depend on the framework or on each adapter author. A store
 * that returns an error value is passed through for the caller to map.
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
