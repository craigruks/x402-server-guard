/**
 * The naive resource handler, mirroring the in-code BaselineResourceServer against
 * the real fork facilitator: verify, deliver (grant), then settle. No lock on the
 * nonce, no binding of the payment to a resource. Every attack drives this.
 */
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

/** The verify/settle surface both the fork and hosted facilitators expose. */
export type Facilitator = {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
};

export type NaiveOutcome = {
  granted: boolean;
  settle?: { ok: boolean; transaction?: string; reason?: string };
};

/** Handle one paid request naively: grant as soon as verify passes, settle after. */
export async function naiveHandle(
  facilitator: Facilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<NaiveOutcome> {
  const verified = await facilitator.verify(payload, requirements);
  if (!verified.isValid) {
    return { granted: false };
  }
  // Granted here, before settlement confirms. That is the flaw the attacks exploit.
  const settled = await facilitator.settle(payload, requirements);
  return {
    granted: true,
    settle: settled.success
      ? { ok: true, transaction: settled.transaction }
      : { ok: false, reason: settled.errorReason },
  };
}
