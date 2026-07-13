/**
 * The baseline resource server with the guard in front: the corrected pattern the
 * attacks are fired at to show them blocked.
 *
 * The secure flow: verify, reserve the payment's nonce through the guard, settle,
 * and only then deliver. The reservation stops the race and replay (the first
 * request for a nonce wins, the rest are denied); settling before delivering means
 * a payment that fails to settle never yields the resource. The guard's decision
 * is a value, so a denial is a plain not-granted, not a throw.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Guard } from "../../src/guard.js";
import { readExactEvmPayload } from "./payment.js";
import type { GrantResult } from "./types.js";

export class GuardedResourceServer<TResource> {
  constructor(
    private readonly facilitator: FacilitatorClient,
    private readonly guard: Guard,
    private readonly deliver: (requirements: PaymentRequirements) => TResource,
    readonly resourceUrl: string = "",
  ) {}

  /** Handle one paid request: reserve the nonce, settle, then grant. */
  async handle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<GrantResult<TResource>> {
    const verification = await this.facilitator.verify(payload, requirements);
    if (!verification.isValid) {
      return { granted: false };
    }

    const parsed = readExactEvmPayload(payload);
    if (!parsed.ok) {
      return { granted: false };
    }
    const { nonce, validBefore } = parsed.value.authorization;
    const reservation = await this.guard.reserve({
      nonce,
      resource: this.resourceUrl,
      expiresAt: Number(validBefore),
    });
    if (!reservation.reserved) {
      return { granted: false, denial: reservation.reason.code };
    }

    // Settle before granting: a payment that does not settle yields no resource.
    const settlement = await this.facilitator.settle(payload, requirements);
    if (!settlement.success) {
      return {
        granted: false,
        settlement: { ok: false, reason: settlement.errorReason ?? "settle failed" },
      };
    }
    return {
      granted: true,
      resource: this.deliver(requirements),
      settlement: { ok: true, txHash: settlement.transaction },
    };
  }
}
