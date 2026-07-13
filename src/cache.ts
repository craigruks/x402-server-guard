/**
 * Cache directives for paid responses.
 *
 * A shared cache (CDN or reverse proxy) keys on the URL and knows nothing about
 * payment, so a cacheable paid 200 can be stored and served to the next caller, paid
 * or not. The reference x402 adapters set no cache directive, leaving that door open.
 *
 * The mitigation is a response directive, not a decision about a nonce, so it lives
 * here as a small pure helper the server or adapter applies to every paid response.
 * `no-store` is load-bearing (no conforming cache stores it); `private` and `Vary` on
 * the payment header are defense in depth.
 */

/** HTTP header directives to attach to a paid response so no cache serves it onward. */
export interface CacheDirectives {
  /** `Cache-Control` value. */
  readonly cacheControl: string;
  /** `Vary` value: the request headers a stored response must key on. */
  readonly vary: string;
}

export interface CacheDirectivesOptions {
  /**
   * The request header the payment travels in, added to `Vary` so a cache that
   * stores despite `no-store` still keys by payer. Defaults to `X-PAYMENT`.
   */
  readonly paymentHeader?: string;
}

/** The cache directives to attach to a paid (200) response. */
export function paidResponseCacheDirectives(options: CacheDirectivesOptions = {}): CacheDirectives {
  const paymentHeader = options.paymentHeader ?? "X-PAYMENT";
  return { cacheControl: "no-store, private", vary: paymentHeader };
}

/**
 * Whether a shared (CDN / reverse-proxy) cache may store a response with this
 * `Cache-Control`. A conforming shared cache refuses to store a `no-store` or
 * `private` response. Used by the caching model in the tests. A CDN in force-cache
 * mode ignores `Cache-Control`; this models a cache that honors it.
 */
export function isStorableBySharedCache(cacheControl: string | undefined): boolean {
  if (cacheControl === undefined || cacheControl === "") {
    return true;
  }
  const normalized = cacheControl.toLowerCase();
  return !normalized.includes("no-store") && !normalized.includes("private");
}
