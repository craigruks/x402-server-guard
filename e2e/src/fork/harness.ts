/**
 * Test-side fork helpers, all in viem: a test client for state control
 * (snapshot / revert / mine come with `createTestClient`) and `deal` for funding,
 * plus a USDC balance read. This replaces the old bash + `cast` provisioning.
 */
import { type Hex, createTestClient, http, parseUnits, publicActions } from "viem";
import { baseSepolia } from "viem/chains";
import { dealActions } from "viem-deal";
import { buyer, config } from "../config.js";

export const FORK_RPC = process.env.FORK_RPC ?? "http://localhost:8545";

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** A viem test client for the fork: snapshot/revert/mine plus reads and `deal`. */
export function testClient() {
  return createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(FORK_RPC) })
    .extend(publicActions)
    .extend(dealActions);
}

export type ForkTestClient = ReturnType<typeof testClient>;

/** Fund the buyer with test USDC by overriding its balance slot (viem-deal). */
export function fundBuyer(client: ForkTestClient): Promise<void> {
  return client.deal({ erc20: config.asset as Hex, account: buyer.address, amount: parseUnits("5", 6) });
}

/** Read a USDC balance on the fork. */
export function usdcBalance(client: ForkTestClient, who: Hex): Promise<bigint> {
  return client.readContract({ address: config.asset as Hex, abi: BALANCE_OF, functionName: "balanceOf", args: [who] });
}
