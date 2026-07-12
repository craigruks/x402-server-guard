/**
 * A deterministic facilitator implementing x402's real `FacilitatorClient`
 * interface, backed by a `FakeChain`.
 *
 * It faithfully reproduces the naive facilitator's two load-bearing flaws:
 *   1. `verify()` is a read-only check with no lock on the nonce. Concurrent
 *      requests all pass while the nonce is still unconsumed.
 *   2. verification checks the financial fields (amount / asset / payTo /
 *      network) but NOT the resource. A payment authorized for one resource
 *      verifies against any equally-priced resource.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FakeChain } from "./fake-chain.js";
import { readExactEvmPayload } from "./payment.js";

export class FakeFacilitator implements FacilitatorClient {
  constructor(private readonly chain: FakeChain) {}

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const parsed = readExactEvmPayload(payload);
    if (!parsed.ok) {
      return { isValid: false, invalidReason: "malformed-payment" };
    }
    const { authorization } = parsed.value;

    if (this.chain.isConsumed(authorization.nonce)) {
      return { isValid: false, invalidReason: "nonce-already-used" };
    }
    const financialsMatch =
      authorization.to === requirements.payTo &&
      BigInt(authorization.value) === BigInt(requirements.amount) &&
      payload.accepted.asset === requirements.asset &&
      payload.accepted.network === requirements.network;
    if (!financialsMatch) {
      return { isValid: false, invalidReason: "requirements-mismatch" };
    }
    // Note: the resource is deliberately NOT checked. That is the flaw.
    return { isValid: true, payer: authorization.from };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const parsed = readExactEvmPayload(payload);
    if (!parsed.ok) {
      return {
        success: false,
        errorReason: "malformed-payment",
        transaction: "",
        network: requirements.network,
      };
    }
    const { authorization } = parsed.value;
    const result = await this.chain.settle(authorization.nonce);
    if (!result.ok) {
      return {
        success: false,
        errorReason: result.reason,
        transaction: "",
        network: requirements.network,
        payer: authorization.from,
      };
    }
    return {
      success: true,
      transaction: result.txHash,
      network: requirements.network,
      payer: authorization.from,
    };
  }

  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: {},
    };
  }
}
