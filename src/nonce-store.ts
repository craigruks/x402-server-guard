/**
 * A store of reserved payment nonces.
 *
 * `reserve` is the load-bearing primitive and MUST be atomic: the check and the set
 * are never split by an `await`. The in-memory store below is atomic by construction
 * (a synchronous body runs to completion); a distributed store must use a genuine
 * atomic compare-and-set (a Durable Object, Redis `SET .. NX`, a unique constraint).
 * Get-then-put stores (Workers KV, S3) reopen the race and are a later chapter.
 *
 * `reserve` and `release` return a `Result`, so a store failure is a value the guard
 * turns into a fail-closed deny. Replay keys on the nonce, never the signature, which
 * is what makes it immune to signature malleability. Full rationale: docs/hardening.md.
 */
import { randomUUID } from "node:crypto";
import { type GuardError, guardError } from "./error.js";
import { err, ok, type Result } from "./result.js";

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

interface Entry {
  readonly resource: string;
  readonly expiresAt: number;
  readonly token: string;
}

/** Construction options for {@link MemoryNonceStore} / {@link createMemoryNonceStore}. */
export interface MemoryNonceStoreOptions {
  /** Clock as unix seconds. Defaults to the system clock. Inject for tests. */
  readonly now?: () => number;
  /** Hard cap on retained reservations; a fresh reserve past it fails closed. */
  readonly maxEntries?: number;
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
 * Memory is bounded two ways: expired reservations are swept (lossless past
 * `validBefore`), and because `expiresAt` is the attacker-signed `validBefore` the
 * sweep alone is no bound, so a hard `maxEntries` cap rejects fresh reservations once
 * reached (fail closed). Not for serverless isolates; use a shared store with a native
 * compare-and-set there. Assumes a monotonic clock (the on-chain `validBefore` check is
 * the end-to-end backstop). Exported for observability in tests; production code should
 * use `createMemoryNonceStore`.
 */
export class MemoryNonceStore implements NonceStore {
  private readonly reserved = new Map<string, Entry>();
  private lastSweep = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: MemoryNonceStoreOptions = {}) {
    this.now = options.now ?? nowSeconds;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Number of reservations currently retained. */
  get size(): number {
    return this.reserved.size;
  }

  reserve({
    nonce,
    resource,
    expiresAt,
  }: ReserveParams): Promise<Result<ReserveOutcome, ReserveError>> {
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
    // Reject a fresh reservation once full rather than grow unbounded or evict a live
    // entry (which reopens the race). Overwriting a dead entry is exempt (no growth).
    if (existing === undefined && this.reserved.size >= this.maxEntries) {
      return Promise.resolve(err(guardError("store-at-capacity", "nonce store at capacity")));
    }
    const token = randomUUID();
    this.reserved.set(nonce, { resource, expiresAt, token });
    return Promise.resolve(ok({ status: "reserved", token }));
  }

  release(nonce: string, token: string): Promise<Result<ReleaseOutcome, StoreError>> {
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
export function createMemoryNonceStore(options: MemoryNonceStoreOptions = {}): NonceStore {
  return new MemoryNonceStore(options);
}
