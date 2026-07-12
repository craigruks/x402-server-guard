/**
 * Settlement race on the forked USDC: sign one payment, fire N naive handles
 * concurrently. All verify against the unconsumed nonce and are granted, while
 * only one settles on-chain; the rest revert on the now-consumed EIP-3009 nonce.
 * This is the empirical check that the real verify takes no nonce lock.
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

test("N concurrent requests are all granted, but only one settles", async () => {
  const facilitator = buildForkFacilitator(FORK_RPC);
  const req = requirements();
  const payment = await signPaymentFor("http://resource.local/report");
  const concurrency = 5;

  const outcomes = await Promise.all(
    Array.from({ length: concurrency }, () => naiveHandle(facilitator, payment, req)),
  );

  const granted = outcomes.filter((o) => o.granted).length;
  const settledOk = outcomes.filter((o) => o.settle?.ok).length;
  expect(granted).toBe(concurrency);
  expect(settledOk).toBe(1);
});
