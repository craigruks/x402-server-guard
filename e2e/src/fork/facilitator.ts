/**
 * A facilitator wired to the local Anvil fork of Base Sepolia.
 *
 * The verify and settle logic is the UNMODIFIED official `@x402/evm` ExactEvmScheme
 * (a pinned dependency, not vendored). The only thing local here is the RPC endpoint:
 * the viem client points at the fork instead of the public network. So verify does
 * the real signature and nonce checks, and settle submits the real EIP-3009
 * transferWithAuthorization against the real (forked) USDC contract.
 */
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { type Hex, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "../config.js";

// Anvil's default account #1, pre-funded with ETH on the fork. The facilitator's
// wallet pays gas to submit the settlement transaction.
const FACILITATOR_KEY = (process.env.FACILITATOR_PRIVATE_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex;

/** Build an x402 facilitator whose scheme logic is @x402/evm, pointed at the fork RPC. */
export function buildForkFacilitator(rpcUrl: string): x402Facilitator {
  const account = privateKeyToAccount(FACILITATOR_KEY);
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  }).extend(publicActions);

  const signer = toFacilitatorEvmSigner(
    Object.assign(client, { address: account.address }) as Parameters<typeof toFacilitatorEvmSigner>[0],
  );
  return new x402Facilitator().register(config.network, new ExactEvmScheme(signer));
}
