/**
 * Payer helpers built on the official @x402/fetch client, so the signing is the
 * real x402 client path (EIP-3009 transferWithAuthorization), not hand-rolled.
 *
 * The one primitive both attacks need: obtain a signed X-PAYMENT header for a
 * resource WITHOUT submitting it, so the caller can then replay it to a different
 * resource (substitution) or fire it concurrently (race).
 */
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { buyer } from "./config.js";

function createPayer(): { client: x402Client; httpClient: x402HTTPClient } {
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(buyer));
  return { client, httpClient: new x402HTTPClient(client) };
}

/**
 * Sign a payment for `url` and return the encoded X-PAYMENT header, without
 * submitting it. Fetches the 402 challenge, signs against it, and stops there.
 */
export async function obtainPaymentHeader(url: string): Promise<Record<string, string>> {
  const { client, httpClient } = createPayer();
  const res = await fetch(url);
  if (res.status !== 402) {
    throw new Error(`expected a 402 challenge from ${url}, got ${res.status}`);
  }
  const body: unknown = await res.json();
  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), body);
  const payload = await client.createPaymentPayload(paymentRequired);
  return httpClient.encodePaymentSignatureHeader(payload);
}
