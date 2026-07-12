/**
 * A deterministic facilitator implementing x402's real `FacilitatorClient`
 * interface, backed by a `FakeChain`.
 *
 * Trust boundary: a real facilitator verifies the EIP-3009 signature over
 * (from, to, value, validAfter, validBefore, nonce). This fake assumes that
 * check has already passed and treats the plaintext authorization as
 * trustworthy. Every attack in this suite survives a correct facilitator; none
 * of them is a forged signature.
 *
 * What it reproduces that a naive integration gets wrong:
 *   1. `verify()` is a read-only check with no lock on the nonce. Concurrent
 *      requests all pass while the nonce is still unconsumed.
 *   2. It checks the financial fields (amount / asset / payTo / network) and
 *      stops there. It does not bind the payment to a resource, and it cannot:
 *      the resource is not in the signed authorization, and the facilitator does
 *      not know which resource the caller is serving. That binding is the
 *      server's job (see the cross-resource-substitution reproduction).
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
    // The resource is not checked here, and cannot be: it is not in the signed
    // authorization. Binding a payment to a resource is the server's job.
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
