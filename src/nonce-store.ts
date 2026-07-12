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
 * already expired (`expiresAt <= now`) and returns `expired`. In the in-memory
 * store this shares the reservation's atomic tick. On a distributed store the
 * double-spend race is closed by the compare-and-set alone (Redis `SET NX`, a
 * unique constraint); the expired refusal can be a separate predicate before the
 * CAS, or folded in with a Lua script or a constraint. That expiry check is only
 * racing `now` crossing a fixed `validBefore`, and the on-chain `validBefore`
 * check is the real backstop, so a separate predicate is acceptable. The wired
 * flow's facilitator verifies the window too; a caller invoking `reserve`
 * directly is covered here.
 *
 * Boundaries a second implementer must match: an entry is still reserved while
 * `expiresAt > now` and free at `expiresAt <= now` (the edge the sweep and the
 * on-chain `block.timestamp < validBefore` share). On `already-reserved` the
 * `boundResource` MUST be read in the same atomic step as the compare-and-set
 * (Redis 7 `SET ... NX GET`, a Lua script, or `INSERT ... ON CONFLICT ...
 * RETURNING`); a separate `GET` can return a stale resource.
 *
 * Replay protection keys on the nonce, never on signature bytes. That is what
 * makes it immune to signature malleability: a malleated ECDSA signature
 * (`(r, s, v)` and `(r, N-s, v^1)` recover the same signer) carries the same
 * signed nonce, so it collides with the existing reservation and is denied
 * identically. A store keyed on the signature would see two distinct byte strings
 * and let the twin through.
 */
import { type GuardError, guardError } from "./error.js";
import { err, ok, type Result } from "./result.js";

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
  /**
   * The resource this payment is being spent on, as a canonical key. The
   * substitution mitigation (a later chapter) compares this to the resource a
   * nonce was first bound to, so equal resources must produce an equal string:
   * normalize trailing slashes, query order, and case before passing it in.
   */
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

/**
 * Hard ceiling on retained reservations. A fresh reserve past this fails closed
 * rather than growing memory without bound, since `expiresAt` is attacker-signed
 * and the sweep cannot reclaim a far-future entry. Sized for a single process;
 * override for the deployment.
 */
const DEFAULT_MAX_ENTRIES = 1_000_000;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * In-memory nonce store for a single process. Atomic because the check and the set
 * share one synchronous tick.
 *
 * Memory is bounded two ways. Expired reservations are swept (past `validBefore` a
 * nonce is unreplayable on-chain, so dropping it is lossless). The sweep alone is
 * NOT a bound: `expiresAt` is the attacker-signed `validBefore`, so a flood of
 * far-future authorizations is retained until, second, a hard `maxEntries` cap
 * rejects fresh reservations (fail closed). Peak retention is roughly
 * `min(maxEntries, request_rate * validBefore_horizon)`. Not suitable across
 * serverless isolates; use a shared store with a native atomic compare-and-set.
 *
 * Assumes a monotonic clock. A backward step (NTP) could un-expire a swept nonce;
 * end to end the on-chain `validBefore` check is the backstop, but the store's
 * standalone replay guarantee assumes time does not move backward.
 *
 * Exported for observability in tests; production code should use
 * `createMemoryNonceStore`.
 */
export class MemoryNonceStore implements NonceStore {
  private readonly reserved = new Map<string, Entry>();
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number = nowSeconds,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

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
    // Reject a fresh reservation once full, rather than growing without bound or
    // evicting a live entry (which would reopen the race). Overwriting an already
    // dead entry does not grow the map, so it is exempt from the cap.
    if (existing === undefined && this.reserved.size >= this.maxEntries) {
      return Promise.resolve(err(guardError("store-at-capacity", "nonce store at capacity")));
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

/**
 * Create an in-memory nonce store. Optionally inject a clock (`() => unixSeconds`)
 * and a hard `maxEntries` cap (fresh reserves past it fail closed).
 */
export function createMemoryNonceStore(now?: () => number, maxEntries?: number): NonceStore {
  return new MemoryNonceStore(now, maxEntries);
}
