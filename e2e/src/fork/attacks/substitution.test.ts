/**
 * Cross-resource substitution on the forked USDC: a payment signed for resource A
 * is granted and settled at the endpoint serving resource B, because the EIP-3009
 * signature does not cover the resource and the naive server binds nothing. The
 * same payment presented to A afterward is denied, its nonce spent.
 */
import { beforeAll, expect, test } from "vitest";
import { buildForkFacilitator } from "../facilitator.js";
import { FORK_RPC, type ForkTestClient, fundBuyer, testClient } from "../harness.js";
import { naiveHandle } from "../naive.js";
import { requirements, signPaymentFor } from "../payer.js";

let client: ForkTestClient;
beforeAll(async () => {
  client = testClient();
  await fundBuyer(client);
});

test("a payment for resource A is honored at resource B, then A is unpayable", async () => {
  const facilitator = buildForkFacilitator(FORK_RPC);
  const req = requirements();

  // Signed for A, presented to the endpoint serving B.
  const payment = await signPaymentFor("http://resource.local/report-A");
  const atB = await naiveHandle(facilitator, payment, req);
  expect(atB.granted).toBe(true);
  expect(atB.settle?.ok).toBe(true);

  // The same payment presented to A is denied: its nonce is spent.
  const atA = await naiveHandle(facilitator, payment, req);
  expect(atA.granted).toBe(false);
});
