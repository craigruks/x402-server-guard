/**
 * Attack reproduction: cache leakage of paid content.
 *
 * A shared cache (CDN or reverse proxy) in front of the resource server keys on
 * the request URL and knows nothing about payment. The baseline lets its paid
 * responses be cached there, with no private/no-store directive and no payer in
 * the key. So the first paying client seeds the cache, and every later client
 * for the same URL is served the paid content for free.
 *
 * This documents the exploit against the unguarded baseline. The mitigation
 * marks paid responses private so the shared cache never stores them, at which
 * point the second fetch here falls through to a payment-required response.
 */
import { describe, expect, it } from "vitest";
import { createGuard } from "../../src/index.js";
import {
  CachingProxy,
  createTestbed,
  FakeChain,
  FakeFacilitator,
  GuardedResourceServer,
  makePayment,
  SharedCache,
} from "../harness/index.js";

const RESOURCE_URL = "https://api.example.com/premium.json";

describe("attack: cache leakage of paid content", () => {
  it("serves a paid response to an unpaid client out of the shared cache", async () => {
    const { server, chain } = createTestbed();
    const cache = new SharedCache<string>();
    const proxy = new CachingProxy(cache, server);
    const { payload, requirements } = makePayment({ resourceUrl: RESOURCE_URL });

    // A paying client populates the shared cache.
    const paid = await proxy.fetch(RESOURCE_URL, { payload, requirements });
    expect(paid.paid).toBe(true);
    expect(paid.served).toBe("the-resource");

    // A second client sends no payment and is served the cached paid content.
    const freeloader = await proxy.fetch(RESOURCE_URL);
    expect(freeloader.paid).toBe(false);
    expect(freeloader.fromCache).toBe(true);
    expect(freeloader.served).toBe(paid.served);

    // One payment settled, but the content went out twice.
    expect(chain.settledCount).toBe(1);
    expect(cache.hitCount).toBe(1);
  });

  it("denies an unpaid client while the cache is cold", async () => {
    // Control: with nothing cached yet, an unpaid request gets no content. The
    // leak needs a prior paid request to seed the cache; it is not a hole in
    // payment enforcement on its own.
    const { server } = createTestbed();
    const proxy = new CachingProxy(new SharedCache<string>(), server);

    const cold = await proxy.fetch(RESOURCE_URL);

    expect(cold.served).toBeUndefined();
    expect(cold.paid).toBe(false);
    expect(cold.fromCache).toBe(false);
  });
});

describe("guarded: cache leakage of paid content", () => {
  it("marks paid responses uncacheable so the shared cache never stores them", async () => {
    const chain = new FakeChain();
    const guard = createGuard();
    const server = new GuardedResourceServer(
      new FakeFacilitator(chain),
      guard,
      () => "the-resource",
      RESOURCE_URL,
    );
    const cache = new SharedCache<string>();
    const proxy = new CachingProxy(cache, server);
    const { payload, requirements } = makePayment({ resourceUrl: RESOURCE_URL });

    // A paying client is served, but the paid response is marked no-store/private.
    const paid = await proxy.fetch(RESOURCE_URL, { payload, requirements });
    expect(paid.paid).toBe(true);
    expect(paid.served).toBe("the-resource");

    // The shared cache honored the directive and stored nothing, so a later unpaid
    // client falls through to no content instead of the leaked paid response.
    const freeloader = await proxy.fetch(RESOURCE_URL);
    expect(freeloader.served).toBeUndefined();
    expect(freeloader.fromCache).toBe(false);
    expect(cache.hitCount).toBe(0);
  });
});
