/**
 * Attack reproduction against the REAL x402 reference resource server.
 *
 * The other attack suites fire at `BaselineResourceServer`, a faithful but
 * hand-written stand-in. This one drives the actual `x402HTTPResourceServer`
 * from `@x402/core` 2.29.0 (the version this repo pins), so the duplicate-settlement
 * race is proven against the class integrators ship, not a re-creation of it.
 * It runs the default `authorization` flow, the one `ExactEvmScheme` uses unless
 * a route opts into `upfront`; reference-flows.test.ts covers that opt-in.
 *
 * Why the race lands: `processHTTPRequest` verifies the payment and returns a
 * `payment-verified` result with NO settlement. Settlement is a separate
 * `processSettlement` call the framework makes AFTER the route handler delivers.
 * `verify()` takes no nonce lock and there is no single-flight, so every
 * concurrent request carrying one payment reaches `payment-verified` while the
 * nonce is still unconsumed. Only the first `processSettlement` consumes it
 * on-chain; the rest fail `nonce-already-used`. Net: N requests reach the handler
 * for one payment.
 *
 * What is real vs. faked: the resource server and its request/settlement path
 * are the unmodified reference classes. The only fakes are the facilitator (the
 * repo `FakeFacilitator`, which implements x402's real `FacilitatorClient`) and
 * a minimal `exact` scheme (x402's real `SchemeNetworkServer` interface, no
 * grant logic). Nothing on the grant path is reimplemented.
 *
 * The guarded contrast reserves the nonce in the reference's own
 * `onProtectedRequest` hook, which runs before verification, so the same flood
 * collapses to one grant. The GuardedResourceServer-based tests in
 * duplicate-settlement-race.test.ts exercise the guard in the reserve-then-settle
 * position; here it sits as a request gate on the real class.
 */

import type { PaymentPayload } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { createGuard } from "../../src/index.js";
import { FakeChain, makePayment, readExactEvmPayload } from "../harness/index.js";
import {
  buildReferenceServer,
  isVerified,
  REFERENCE_URL,
  referenceRequest,
} from "../harness/reference-server.js";

describe("attack: duplicate-settlement race against the real @x402/core reference server", () => {
  it("grants payment-verified to every concurrent request for one nonce, then settles only once", async () => {
    const CONCURRENCY = 20;
    const chain = new FakeChain();
    const fixture = makePayment();
    const { http: server } = buildReferenceServer(chain, fixture);
    await server.initialize();
    const context = referenceRequest(fixture);

    // Fire the same payment at the real request path concurrently.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => server.processHTTPRequest(context)),
    );

    // The race: the reference reaches the deliver state N times for one nonce,
    // and nothing has settled yet. Verify carries no lock; settlement is a
    // separate step the framework has not taken.
    const verified = results.filter(isVerified);
    expect(verified.length).toBe(CONCURRENCY);
    expect(chain.settledCount).toBe(0);

    // Now run the settlements the framework would run after each handler. The
    // chain nonce is single-use, so exactly one succeeds; the rest fail.
    const settlements = await Promise.all(
      verified.map((r) => server.processSettlement(r.paymentPayload, r.paymentRequirements)),
    );
    const settledOk = settlements.filter((s) => s.success).length;

    expect(settledOk).toBe(1);
    expect(chain.settledCount).toBe(1);
    // N deliveries for one settled payment: N - 1 resources handed out for free.
    expect(verified.length - settledOk).toBe(CONCURRENCY - 1);
  });

  it("does not reproduce sequentially: once settled, the second request is denied at verify", async () => {
    // Control: with no concurrent overlap the first settlement consumes the
    // nonce before the second request is verified, so the second verify sees a
    // consumed nonce and is denied (payment-error, not payment-verified). This
    // isolates concurrency, not the payment itself, as the trigger. The race in
    // the case above works precisely because all verifies land inside the window
    // before the first settlement closes it.
    const chain = new FakeChain();
    const fixture = makePayment();
    const { http: server } = buildReferenceServer(chain, fixture);
    await server.initialize();
    const context = referenceRequest(fixture);

    const first = await server.processHTTPRequest(context);
    if (!isVerified(first)) throw new Error("first request was not verified");
    const firstSettle = await server.processSettlement(
      first.paymentPayload,
      first.paymentRequirements,
    );

    const second = await server.processHTTPRequest(context);

    expect(firstSettle.success).toBe(true);
    expect(second.type).toBe("payment-error");
    expect(chain.settledCount).toBe(1);
  });
});

describe("guarded: the same flood against the real reference server", () => {
  it("collapses to exactly one grant when the guard reserves the nonce in onProtectedRequest", async () => {
    const CONCURRENCY = 20;
    const chain = new FakeChain();
    const fixture = makePayment();
    const { http: server } = buildReferenceServer(chain, fixture);
    const guard = createGuard();

    // Reserve the nonce on the reference's own pre-payment hook. reserve() is
    // atomic, so only the first of a concurrent flood is admitted; the rest are
    // aborted before verification. Reading the nonce off the request keeps the
    // gate honest (it does not lean on the shared fixture).
    server.onProtectedRequest(async (ctx) => {
      const header = ctx.adapter.getHeader("payment-signature");
      if (header === undefined) return;
      const decoded: PaymentPayload = JSON.parse(Buffer.from(header, "base64").toString());
      const parsed = readExactEvmPayload(decoded);
      if (!parsed.ok) return { abort: true, reason: "unreadable-payment" };
      const { nonce, validBefore } = parsed.value.authorization;
      const reservation = await guard.reserve({
        nonce,
        resource: REFERENCE_URL,
        expiresAt: Number(validBefore),
      });
      if (!reservation.reserved) return { abort: true, reason: reservation.reason.code };
      return;
    });

    await server.initialize();
    const context = referenceRequest(fixture);

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => server.processHTTPRequest(context)),
    );

    const verified = results.filter(isVerified).length;
    const aborted = results.filter((r) => r.type === "payment-error").length;

    // One nonce, one grant. The rest never reach verification.
    expect(verified).toBe(1);
    expect(aborted).toBe(CONCURRENCY - 1);
  });
});
