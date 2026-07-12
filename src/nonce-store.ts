/**
 * A store of reserved payment nonces.
 *
 * `reserve` is the guard's load-bearing primitive: the first caller to reserve a
 * nonce wins, and every later caller (a replay or a concurrent race) is told the
 * nonce is already taken. It MUST be atomic: the check and the set cannot be split
 * by an `await`. The in-memory store below is atomic by construction (JS runs a
 * synchronous body to completion). A distributed store must use a genuine atomic
 * compare-and-set: a Durable Object, Redis `SET ... NX`, or a database unique
 * constraint. Plain get-then-put stores (Cloudflare Workers KV, S3) are NOT
 * sufficient: they have no compare-and-set, so an `await` sits in the check-to-set
 * gap and reopens the settlement race. Those adapters are a later chapter.
 *
 * `reserve` returns a `Result` so a store I/O failure is a value, not a throw: the
 * guard turns any store error into a fail-closed deny rather than letting it
 * escape into the request path. A reserved nonce is bound to the resource it was
 * first reserved for (so a later mitigation can reject a rebind) and carries the
 * authorization's expiry (so the store can evict it once the payment can no longer
 * be replayed on-chain).
 *
 * The expiry does double duty: `reserve` also refuses an authorization that is
 * already expired (`expiresAt <= now`), so the validity window is enforced in the
 * same atomic step as the reservation. Checking the window in a separate earlier
 * step would reopen a time-of-check/time-of-use gap for a distributed store; the
 * wired flow's facilitator verifies the window too, but a caller invoking
 * `reserve` directly is covered here rather than relying on that.
 *
 * Replay protection keys on the nonce, never on signature bytes. That is what
 * makes it immune to signature malleability: a malleated ECDSA signature
 * (`(r, s, v)` and `(r, N-s, v^1)` recover the same signer) carries the same
 * signed nonce, so it collides with the existing reservation and is denied
 * identically. A store keyed on the signature would see two distinct byte strings
 * and let the twin through.
 */
import type { GuardError } from "./error.js";
import { ok, type Result } from "./result.js";

/** The outcome of a successful reserve. */
export type ReserveOutcome =
  | { readonly status: "reserved" }
  | { readonly status: "already-reserved"; readonly boundResource: string }
  | { readonly status: "expired" };

export interface ReserveParams {
  /**
   * The payment's nonce. Must be unique within its (chain, asset, payer) scope;
   * for the x402 exact scheme it is a random 32-byte value, so a bare nonce is
   * safe. A caller using a non-random nonce source must compose that scope in.
   */
  readonly nonce: string;
  /** The resource this payment is being spent on. */
  readonly resource: string;
  /**
   * Unix seconds, the authorization's `validBefore`. Used two ways: `reserve`
   * refuses an authorization whose window has already closed (`expiresAt <= now`),
   * and once past this time a live reservation may be evicted (the nonce is
   * unreplayable on-chain, so dropping it is lossless).
   */
  readonly expiresAt: number;
}

/** A store of reserved payment nonces. `reserve` must be atomic. */
export interface NonceStore {
  reserve(params: ReserveParams): Promise<Result<ReserveOutcome, GuardError>>;
}

interface Entry {
  resource: string;
  expiresAt: number;
}

/** How often (in the store's clock, unix seconds) to sweep expired reservations. */
const SWEEP_INTERVAL_SECONDS = 60;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * In-memory nonce store for a single process. Atomic because the check and the set
 * share one synchronous tick. Bounds memory by evicting reservations whose
 * authorization has expired, so a flood of unique attacker-chosen nonces cannot
 * grow it without limit. Not suitable across serverless isolates; use a shared
 * store with a native atomic compare-and-set there.
 *
 * Exported for observability in tests; production code should use
 * `createMemoryNonceStore`.
 */
export class MemoryNonceStore implements NonceStore {
  private readonly reserved = new Map<string, Entry>();
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = nowSeconds) {}

  /** Number of reservations currently retained. */
  get size(): number {
    return this.reserved.size;
  }

  reserve({
    nonce,
    resource,
    expiresAt,
  }: ReserveParams): Promise<Result<ReserveOutcome, GuardError>> {
    const now = this.now();
    this.maybeSweep(now);

    // An already-expired authorization is never grantable: refuse it in the same
    // atomic step, before touching the reservation map.
    if (expiresAt <= now) {
      return Promise.resolve(ok({ status: "expired" }));
    }

    const existing = this.reserved.get(nonce);
    if (existing !== undefined && existing.expiresAt > now) {
      return Promise.resolve(ok({ status: "already-reserved", boundResource: existing.resource }));
    }
    this.reserved.set(nonce, { resource, expiresAt });
    return Promise.resolve(ok({ status: "reserved" }));
  }

  /** Periodically drop expired reservations so unique-nonce floods stay bounded. */
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < SWEEP_INTERVAL_SECONDS) {
      return;
    }
    this.lastSweep = now;
    for (const [nonce, entry] of this.reserved) {
      if (entry.expiresAt <= now) {
        this.reserved.delete(nonce);
      }
    }
  }
}

/** Create an in-memory nonce store. Optionally inject a clock (`() => unixSeconds`). */
export function createMemoryNonceStore(now?: () => number): NonceStore {
  return new MemoryNonceStore(now);
}
