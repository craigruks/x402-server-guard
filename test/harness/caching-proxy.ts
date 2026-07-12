/**
 * A shared cache (CDN / reverse proxy) fronting the baseline resource server.
 *
 * On a cache miss it goes to the origin, which requires payment; on a hit it
 * replays the stored response with no origin call and no payment. The security
 * question is what it does with a paid response, and the baseline answers it the
 * unsafe way: it stores the paid content in the shared cache under the URL, with
 * no private/no-store directive and no payer in the key. So the next request for
 * that URL is served the paid content for free. The guard later marks paid
 * responses private, at which point this cache never stores them.
 */
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { isStorableBySharedCache } from "../../src/cache.js";
import type { SharedCache } from "./shared-cache.js";
import type { GrantResult } from "./types.js";

/** Minimal resource-server shape the proxy fronts: baseline or guarded. */
export interface ProxiedServer<TResource> {
  handle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<GrantResult<TResource>>;
}

export interface FetchOutcome<TResource> {
  /** The response body, absent when the request is denied. */
  served?: TResource;
  /** Whether the response came from the shared cache rather than the origin. */
  fromCache: boolean;
  /** Whether this request settled a payment. */
  paid: boolean;
}

export interface PaymentAttempt {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

export class CachingProxy<TResource> {
  constructor(
    private readonly cache: SharedCache<TResource>,
    private readonly origin: ProxiedServer<TResource>,
  ) {}

  /** Fetch a URL, optionally presenting a payment. */
  async fetch(url: string, payment?: PaymentAttempt): Promise<FetchOutcome<TResource>> {
    const cached = this.cache.read(url);
    if (cached !== undefined) {
      return { served: cached, fromCache: true, paid: false };
    }
    if (!payment) {
      return { fromCache: false, paid: false };
    }

    const result = await this.origin.handle(payment.payload, payment.requirements);
    if (!result.granted || result.resource === undefined) {
      return { fromCache: false, paid: false };
    }

    // A correct shared cache stores the paid response only if its Cache-Control
    // allows it. The baseline sets none, so it is stored and leaks; the guarded
    // server marks it no-store/private, so it is never stored.
    if (isStorableBySharedCache(result.cacheControl)) {
      this.cache.write(url, result.resource);
    }
    return { served: result.resource, fromCache: false, paid: true };
  }
}
