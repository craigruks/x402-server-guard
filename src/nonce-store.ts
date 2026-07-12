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
 * `reserve` and `release` return a `Result`, so a store I/O failure is a value,
 * not a throw: the guard turns any store error into a fail-closed deny. A reserved
 * nonce is bound to the resource it was first reserved for (to reject a rebind),
 * carries the authorization's expiry (to evict once it can no longer be replayed
 * on-chain), and gets a fencing `token` only its holder can `release` with.
 *
 * `reserve` also refuses an already-expired authorization (`expiresAt <= now`,
 * returning `expired`), enforcing the closing edge of the window. On a distributed
 * store the compare-and-set closes the double-spend race on its own; the expiry
 * refusal can be a separate predicate before it (only `now` crossing a fixed
 * `validBefore` races, and the on-chain check is the backstop). The facilitator
 * verifies the window too; a direct `reserve` caller is covered here.
 *
 * Boundaries a second implementer must match: an entry is reserved while
 * `expiresAt > now`, free at `expiresAt <= now`. On `already-reserved` the
 * `boundResource` MUST be read atomically with the compare-and-set (Redis 7
 * `SET .. NX GET`, a Lua script, or `INSERT .. ON CONFLICT .. RETURNING`); a
 * separate `GET` can return a stale resource.
 *
 * Replay keys on the nonce, never the signature, which is what makes it immune to
 * signature malleability (a malleated twin carries the same signed nonce and
 * collides). See `docs/hardening.md` for the full rationale.
 */
import { randomUUID } from "node:crypto";
import { type GuardError, guardError } from "./error.js";
import { err, ok, type Result } from "./result.js";

/**
 * The outcome of a reserve. `reserved` carries a fencing `token`: only the holder
 * of that token can later `release` the reservation, so releasing an in-flight
 * hold is not a griefing primitive an attacker can trigger for another payer.
 */
export type ReserveOutcome =
  | { readonly status: "reserved"; readonly token: string }
  | { readonly status: "already-reserved"; readonly boundResource: string }
  | { readonly status: "expired" };

/** The outcome of a release. `not-held` means no matching token: nothing was freed. */
export type ReleaseOutcome = { readonly status: "released" } | { readonly status: "not-held" };

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
  /**
   * Release a reservation so the nonce can be reserved again. Used to free a hold
   * when a settlement fails or is reorged before finality, so a legitimate payer
   * can retry the same authorization. Releases only if `token` matches the token
   * `reserve` returned (fencing); otherwise it frees nothing (`not-held`).
   */
  release(nonce: string, token: string): Promise<Result<ReleaseOutcome, GuardError>>;
}

interface Entry {
  resource: string;
  expiresAt: number;
  token: string;
}

/** How often (in the store's clock, unix seconds) to sweep expired reservations. */
const SWEEP_INTERVAL_SECONDS = 60;

/**
 * Hard ceiling on retained reservations: a fresh reserve past this fails closed
 * rather than growing without bound (`expiresAt` is attacker-signed, so the sweep
 * cannot reclaim a far-future entry). Override for the deployment.
 */
const DEFAULT_MAX_ENTRIES = 1_000_000;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * In-memory nonce store for a single process. Atomic because the check and the set
 * share one synchronous tick.
 *
 * Memory is bounded two ways. Expired reservations are swept (lossless: past
 * `validBefore` the nonce is unreplayable on-chain). The sweep alone is NOT a
 * bound, since `expiresAt` is the attacker-signed `validBefore`, so a hard
 * `maxEntries` cap rejects fresh reservations (fail closed) once reached. Peak
 * retention is roughly `min(maxEntries, request_rate * validBefore_horizon)`. Not
 * for serverless isolates; use a shared store with a native compare-and-set there.
 * Assumes a monotonic clock (a backward NTP step could un-expire a swept nonce;
 * the on-chain `validBefore` check is the end-to-end backstop).
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
    const token = randomUUID();
    this.reserved.set(nonce, { resource, expiresAt, token });
    return Promise.resolve(ok({ status: "reserved", token }));
  }

  release(nonce: string, token: string): Promise<Result<ReleaseOutcome, GuardError>> {
    const entry = this.reserved.get(nonce);
    // Fencing: free the nonce only for the holder of the matching token. A missing
    // entry (expired, swept, already released) or a wrong token frees nothing.
    if (entry === undefined || entry.token !== token) {
      return Promise.resolve(ok({ status: "not-held" }));
    }
    this.reserved.delete(nonce);
    return Promise.resolve(ok({ status: "released" }));
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
