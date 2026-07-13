/**
 * The guard: server-side x402 hardening as decisions, not exceptions.
 *
 * A merchant reserves a payment's nonce before granting the resource. The first
 * request for a nonce is allowed; a replay or a concurrent race is denied. The
 * decision is a value (`Reservation`), never a throw, so a stray `try/catch`
 * cannot turn a deny into an accidental grant. A store failure fails closed: an
 * unavailable store denies, it never grants.
 *
 * This is the framework-agnostic core. An adapter wires it into `@x402/core`'s
 * resource-server lifecycle hooks; a hand-rolled server can call `reserve`
 * directly.
 */
import { type GuardError, guardError } from "./error.js";
import { createMemoryNonceStore, type NonceStore, type ReserveParams } from "./nonce-store.js";
import { tryCatchAsync } from "./result.js";

/** The deny reasons a reservation can carry. */
export type GuardErrorCode = "nonce-already-reserved" | "nonce-expired" | "store-unavailable";

export interface GuardOptions {
  /** Where reserved nonces are tracked. Defaults to an in-memory store. */
  store?: NonceStore;
}

/** A guard decision: reserved (grant may proceed) or denied with a typed reason. */
export type Reservation =
  | { readonly reserved: true }
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
        case "reserved":
          return { reserved: true };
        case "already-reserved":
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
