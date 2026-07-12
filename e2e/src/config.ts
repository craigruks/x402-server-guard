/**
 * Environment and network configuration for the live spike.
 *
 * Loads the buyer wallet from BUYER_PRIVATE_KEY and resolves Base Sepolia
 * defaults. Fails fast if the key is missing, since nothing downstream works
 * without a funded payer.
 */
import "dotenv/config";
import { type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "" || value === "0x") {
    throw new Error(`Missing required env ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** The payer. Fund this address with test USDC from https://faucet.circle.com. */
export const buyer = privateKeyToAccount(required("BUYER_PRIVATE_KEY") as Hex);

export const config = {
  /** Facilitator base URL. Keyless hosted by default; localhost for the self-hosted rig. */
  facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
  /** CAIP-2 network id. Base Sepolia by default. The `chain:reference` shape matches x402's Network type. */
  network: (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`,
  /** Payment asset. Circle test USDC on Base Sepolia by default. */
  asset: getAddress(process.env.ASSET_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  /** Price per request in atomic token units (decimal string). */
  priceAtomic: process.env.PRICE_ATOMIC ?? "1000",
  /** Recipient. Defaults to the buyer, so the spike pays itself and loses nothing. */
  payTo: getAddress(process.env.PAY_TO_ADDRESS ?? buyer.address),
} as const;
