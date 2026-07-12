/**
 * Rig proof: a real payment verifies and settles against the fork, moving forked
 * USDC by the exact price. Not an attack, just evidence the harness is faithful.
 */
import { type Hex } from "viem";
import { beforeAll, expect, test } from "vitest";
import { config } from "../config.js";
import { buildForkFacilitator } from "./facilitator.js";
import { FORK_RPC, type ForkTestClient, fundBuyer, testClient, usdcBalance } from "./harness.js";
import { requirements, signPaymentFor } from "./payer.js";

let client: ForkTestClient;
beforeAll(async () => {
  client = testClient();
  await fundBuyer(client);
});

test("a real payment verifies, settles, and moves forked USDC", async () => {
  const facilitator = buildForkFacilitator(FORK_RPC);
  const req = requirements();
  const payTo = config.payTo as Hex;
  const before = await usdcBalance(client, payTo);

  const payment = await signPaymentFor("http://resource.local/report");
  const verified = await facilitator.verify(payment, req);
  expect(verified.isValid).toBe(true);

  const settled = await facilitator.settle(payment, req);
  expect(settled.success).toBe(true);

  const after = await usdcBalance(client, payTo);
  expect(after - before).toBe(BigInt(req.amount));
});
