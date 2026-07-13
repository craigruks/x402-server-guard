/**
 * Cache directives for paid responses.
 *
 * A shared cache (CDN or reverse proxy) in front of the resource server keys on
 * the request URL and knows nothing about payment. If a paid 200 is cacheable, the
 * cache stores it and serves it to the next caller for that URL, paid or not: the
 * paid content leaks for free. The reference x402 adapters set no cache directive
 * on the paid response, so a shared cache is free to store it.
 *
 * The mitigation is a response directive, not a decision the guard makes about a
 * nonce, so it lives here as a small pure helper the server or adapter applies to
 * every paid response. `no-store` tells every cache, shared or private, not to
 * store the response at all; `private` additionally forbids a shared cache from
 * storing it even if `no-store` were relaxed. `Vary` on the payment header keeps a
 * cache that stores anyway from serving one payer's response to another.
 *
 * `no-store` is the load-bearing directive; the rest are defense in depth. A cache
 * that honors HTTP (any CDN) will not store a `no-store` response.
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
 * Whether a shared (CDN / reverse-proxy) cache may store a response carrying this
 * `Cache-Control`. A conforming shared cache uses exactly this predicate: it
 * refuses to store a `no-store` or `private` response. Used by the caching model
 * in the tests. Note a CDN in a force-cache / "cache everything" mode ignores
 * `Cache-Control` entirely; this models a cache that honors the header.
 */
export function isStorableBySharedCache(cacheControl: string | undefined): boolean {
  if (cacheControl === undefined || cacheControl === "") {
    return true;
  }
  const normalized = cacheControl.toLowerCase();
  return !normalized.includes("no-store") && !normalized.includes("private");
}
