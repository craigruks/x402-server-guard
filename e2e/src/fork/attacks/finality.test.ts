/**
 * Grant-before-finality on the forked USDC, via a reorg. The naive server grants
 * at zero confirmations; a snapshot before the payment and a revert after is the
 * reorg: the resource was granted, but the settling transaction and its USDC
 * movement are gone. Only a chain whose ordering you control can show this.
 */
import { type Hex } from "viem";
import { beforeAll, expect, test } from "vitest";
import { config } from "../../config.js";
import { buildForkFacilitator } from "../facilitator.js";
import { FORK_RPC, type ForkTestClient, fundBuyer, testClient, usdcBalance } from "../harness.js";
import { naiveHandle } from "../naive.js";
import { requirements, signPaymentFor } from "../payer.js";

let client: ForkTestClient;
beforeAll(async () => {
  client = testClient();
  await fundBuyer(client);
});

test("a granted payment is reorged away, leaving the resource delivered for free", async () => {
  const facilitator = buildForkFacilitator(FORK_RPC);
  const req = requirements();
  const payTo = config.payTo as Hex;

  const snapshotId = await client.snapshot();
  const before = await usdcBalance(client, payTo);

  // Naive grant at zero confirmations.
  const payment = await signPaymentFor("http://resource.local/report");
  const outcome = await naiveHandle(facilitator, payment, req);
  expect(outcome.granted).toBe(true);
  expect(outcome.settle?.ok).toBe(true);
  expect((await usdcBalance(client, payTo)) - before).toBe(BigInt(req.amount));

  // Reorg the settling transaction out.
  await client.revert({ id: snapshotId });
  expect(await usdcBalance(client, payTo)).toBe(before);
});
