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
import type { BaselineResourceServer } from "./baseline-server.js";
import type { SharedCache } from "./shared-cache.js";

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
    private readonly origin: BaselineResourceServer<TResource>,
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

    // FLAW: the paid response is cached in the shared cache under the URL alone,
    // so the next caller for this URL is served it whether or not they paid.
    this.cache.write(url, result.resource);
    return { served: result.resource, fromCache: false, paid: true };
  }
}
