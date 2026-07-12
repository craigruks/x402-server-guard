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
      const result = await store.reserve(params);
      if (!result.ok) {
        // Fail closed: a store failure must never become an accidental grant.
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
