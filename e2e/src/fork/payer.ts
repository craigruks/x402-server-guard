/**
 * Buyer-side signing for the fork PoC, on the official @x402/fetch client.
 *
 * Builds the payment requirements a naive server would advertise and signs a real
 * EIP-3009 transferWithAuthorization against them, returning the payment payload.
 * No HTTP server is involved: the PoC constructs the challenge directly and signs
 * it, the way a forge PoC calls the contract directly.
 */
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/fetch";
import { buyer, config } from "../config.js";

/** The requirements every resource advertises. Same price on purpose. */
export function requirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: config.priceAtomic,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };
}

/** The 402 challenge a naive server would return for a resource. */
export function challengeFor(resourceUrl: string): PaymentRequired {
  return { x402Version: 2, resource: { url: resourceUrl }, accepts: [requirements()] };
}

/** Sign a real payment authorizing the challenge for `resourceUrl`. */
export function signPaymentFor(resourceUrl: string): Promise<PaymentPayload> {
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(buyer));
  return client.createPaymentPayload(challengeFor(resourceUrl));
}
