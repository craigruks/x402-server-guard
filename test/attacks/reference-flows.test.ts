/**
 * What upstream added between `@x402/core` 2.21.0 and 2.29.0 that bears on the
 * guard's mitigations, proven against the real reference server rather than
 * read off a changelog. docs/hardening.md cites these tests for its "partly
 * covered upstream" entries.
 *
 * 1. Payment flows (x402-foundation/x402#3053, 2.22.0). A scheme can offer an
 *    `upfront` flow, which settles before the handler runs. `ExactEvmScheme`
 *    offers it for EIP-3009 but defaults to `authorization` (verify, handler,
 *    settle), where reference-race.test.ts still lands the race.
 * 2. `AfterSettleAbortError` (x402-foundation/x402#3994, 2.29.0). An afterSettle
 *    hook can now turn a successful settlement into a failed one, so a merchant
 *    can withhold delivery from inside the reference server.
 */
import { AfterSettleAbortError } from "@x402/core/server";
import { describe, expect, it } from "vitest";
import {
  FakeChain,
  FINALITY_CONFIRMATIONS,
  makePayment,
  readExactEvmPayload,
} from "../harness/index.js";
import { buildReferenceServer, isVerified, referenceRequest } from "../harness/reference-server.js";

describe("upstream: the opt-in upfront flow settles before the handler", () => {
  it("lets one of twenty concurrent requests for one payment through, settled", async () => {
    const CONCURRENCY = 20;
    const chain = new FakeChain();
    const fixture = makePayment();
    const { http } = buildReferenceServer(chain, fixture, "upfront");
    await http.initialize();
    const request = referenceRequest(fixture);

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => http.processHTTPRequest(request)),
    );

    // Each request settles before it is admitted, and the chain nonce is single
    // use, so only the request whose settlement won reaches the handler.
    const verified = results.filter(isVerified);
    expect(verified.length).toBe(1);
    expect(verified[0]?.beforeHandlerSettlement?.result.success).toBe(true);
    expect(results.filter((r) => r.type === "payment-error").length).toBe(CONCURRENCY - 1);
    expect(chain.settledCount).toBe(1);
  });
});

describe("upstream: an afterSettle hook can fail a settlement closed", () => {
  it("reports failure for a settlement the hook rejects, after the funds moved", async () => {
    const chain = new FakeChain();
    const fixture = makePayment();
    const parsed = readExactEvmPayload(fixture.payload);
    if (!parsed.ok) throw parsed.error;
    const { nonce } = parsed.value.authorization;
    const { core, http } = buildReferenceServer(chain, fixture);
    // A finality hold written as a hook: reject a settlement that is not yet
    // buried. FakeChain lands every settlement at zero confirmations.
    core.onAfterSettle(async ({ result }) => {
      if ((chain.confirmationsOf(nonce) ?? 0) < FINALITY_CONFIRMATIONS) {
        throw new AfterSettleAbortError("not-final", `held ${result.transaction}`);
      }
    });
    await http.initialize();

    const first = await http.processHTTPRequest(referenceRequest(fixture));
    if (!isVerified(first)) throw new Error("request was not verified");
    const settled = await http.processSettlement(first.paymentPayload, first.paymentRequirements);

    // The adapter withholds the body on a failed settlement, so nothing is
    // delivered. The transfer still happened: the hook decides delivery, not
    // payment, which is the same trade the guard's `finality: "confirm"` makes.
    expect(settled.success).toBe(false);
    expect(settled.success ? undefined : settled.errorReason).toBe("not-final");
    expect(chain.settledCount).toBe(1);
  });
});
