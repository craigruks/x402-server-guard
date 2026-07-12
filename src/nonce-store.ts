/**
 * A store of reserved payment nonces.
 *
 * `reserve` is the guard's load-bearing primitive: the first caller to reserve a
 * nonce wins, and every later caller (a replay or a concurrent race) is told the
 * nonce is already taken. It MUST be atomic. In a single process an in-memory
 * check-and-set is atomic because it never awaits between the check and the set;
 * a distributed store (KV, Redis, Durable Object) must provide its own atomic
 * reserve. Those adapters are a later chapter; the default here is in-memory.
 *
 * The nonce is bound to the resource it was first reserved for. The race
 * mitigation only needs the nonce lock; the resource binding is what a later
 * mitigation reads to stop cross-resource substitution.
 */

/** The outcome of trying to reserve a nonce. */
export type ReserveOutcome =
  | { readonly status: "reserved" }
  | { readonly status: "already-reserved" };

export interface ReserveParams {
  readonly nonce: string;
  readonly resource: string;
}

/** A store of reserved payment nonces. `reserve` must be atomic. */
export interface NonceStore {
  reserve(params: ReserveParams): Promise<ReserveOutcome>;
}

/**
 * In-memory nonce store for a single process. Atomic because the check and the
 * set share one synchronous tick. Not suitable across serverless isolates; use a
 * shared-store adapter there.
 */
export class MemoryNonceStore implements NonceStore {
  private readonly reserved = new Map<string, string>();

  reserve({ nonce, resource }: ReserveParams): Promise<ReserveOutcome> {
    if (this.reserved.has(nonce)) {
      return Promise.resolve({ status: "already-reserved" });
    }
    this.reserved.set(nonce, resource);
    return Promise.resolve({ status: "reserved" });
  }
}
