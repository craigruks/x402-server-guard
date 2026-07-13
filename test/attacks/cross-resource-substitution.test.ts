/**
 * Attack reproduction: cross-resource substitution.
 *
 * The EIP-3009 authorization a payer signs covers (from, to, value, validAfter,
 * validBefore, nonce). It does not cover the resource, and `PaymentPayload.resource`
 * is unsigned, client-supplied metadata. So a payment is cryptographically just
 * "transfer value to payTo"; nothing in it binds to the resource being bought.
 *
 * A payment is thus bound to a resource only as finely as the signed fields allow.
 * A different payTo or price is caught by the facilitator's parameter matching. But
 * two resources behind one payTo at the same price are indistinguishable at the
 * payment layer, and the baseline has no binding to fall back on: a payment meant
 * for resource A is accepted, granted, and settled by the endpoint serving B,
 * spending the payer's single-use payment on something they did not ask for.
 *
 * The fix cannot be a check on the payload (the resource field is unsigned), and
 * the exact scheme's fixed six-field signature cannot carry a server-issued
 * identifier either. So for equally-priced resources behind one payTo the guard
 * has to bind server-side: tie the client-chosen nonce to the resource it is first
 * presented for and reject it elsewhere. `resourceUrl` here marks what each endpoint
 * serves; it is what that server-side binding attaches to.
 */
import { describe, expect, it } from "vitest";
import { createGuard } from "../../src/index.js";
import {
  BaselineResourceServer,
  createTestbed,
  FakeChain,
  FakeFacilitator,
  GuardedResourceServer,
  makePayment,
} from "../harness/index.js";

const RESOURCE_A = "https://api.example.com/report-A";
const RESOURCE_B = "https://api.example.com/report-B";

describe("attack: cross-resource substitution", () => {
  it("grants a payment authorized for resource A at the endpoint serving resource B", async () => {
    // The endpoint serves B; the payment's unsigned resource hint names A. Same price.
    const { chain, server } = createTestbed({ resourceUrl: RESOURCE_B });
    const { payload, requirements } = makePayment({ resourceUrl: RESOURCE_A });

    // Precondition: the payment's resource hint and the served resource differ.
    expect(payload.resource?.url).toBe(RESOURCE_A);
    expect(server.resourceUrl).toBe(RESOURCE_B);

    const result = await server.handle(payload, requirements);

    // Nothing binds the payment to A, so B is served and the payment settles.
    expect(result.granted).toBe(true);
    expect(result.settlement?.ok).toBe(true);
    expect(chain.settledCount).toBe(1);
  });

  it("spends the payer's nonce on B, leaving the resource A they paid for unpayable", async () => {
    // Endpoints A and B share one chain, as two resources behind one facilitator do.
    const chain = new FakeChain();
    const facilitator = new FakeFacilitator(chain);
    const serverA = new BaselineResourceServer(facilitator, () => "resource-A", RESOURCE_A);
    const serverB = new BaselineResourceServer(facilitator, () => "resource-B", RESOURCE_B);
    const { payload, requirements } = makePayment({ resourceUrl: RESOURCE_A });

    // An attacker sends the payer's payment to endpoint B first.
    const atB = await serverB.handle(payload, requirements);
    // The payer then presents their own payment to the resource they meant to buy.
    const atA = await serverA.handle(payload, requirements);

    expect(atB.granted).toBe(true); // B served using the payer's payment
    expect(atA.granted).toBe(false); // A denied: the nonce is already spent
    expect(chain.settledCount).toBe(1);
  });
});

describe("guarded: cross-resource substitution", () => {
  it("binds the nonce to one resource and denies the other as a substitution", async () => {
    // The guard binds at reserve, BEFORE settle, so it catches substitution in the
    // window the on-chain nonce is not yet consumed, exactly where the facilitator's
    // post-settle nonce check cannot help. Present one payment concurrently to two
    // resources (A and B) behind one merchant, sharing one guard. A settlement
    // latency keeps both verifies passing before either settle lands.
    const chain = new FakeChain(25);
    const guard = createGuard();
    const serverA = new GuardedResourceServer(
      new FakeFacilitator(chain),
      guard,
      () => "resource-A",
      RESOURCE_A,
    );
    const serverB = new GuardedResourceServer(
      new FakeFacilitator(chain),
      guard,
      () => "resource-B",
      RESOURCE_B,
    );
    const { payload, requirements } = makePayment({ resourceUrl: RESOURCE_A });

    const [atA, atB] = await Promise.all([
      serverA.handle(payload, requirements),
      serverB.handle(payload, requirements),
    ]);

    // Exactly one resource is served (the one that reserved first binds the nonce);
    // the other is denied specifically as a substitution, not a plain replay.
    const granted = [atA, atB].filter((r) => r.granted);
    const denied = [atA, atB].filter((r) => !r.granted);
    expect(granted).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.denial).toBe("nonce-resource-mismatch");
    // Only the bound resource ever settled; the substitution never reached settle.
    expect(chain.settledCount).toBe(1);
  });
});
