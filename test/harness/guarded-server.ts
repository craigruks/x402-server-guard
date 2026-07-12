/**
 * The baseline resource server with the guard in front: the corrected pattern the
 * attacks are fired at to show them blocked.
 *
 * Same flow as the baseline, with one addition: after the facilitator verifies,
 * it reserves the payment's nonce through the guard before delivering. The first
 * request for a nonce reserves and is granted; a replay or a concurrent race is
 * denied. The guard's decision is a value, so a denial is a plain not-granted, not
 * a throw.
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

  /** Handle one paid request, reserving the nonce before granting. */
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
    const reservation = await this.guard.reserve({
      nonce: parsed.value.authorization.nonce,
      resource: this.resourceUrl,
    });
    if (!reservation.reserved) {
      return { granted: false };
    }

    const resource = this.deliver(requirements);
    const settlement = await this.facilitator.settle(payload, requirements);
    return {
      granted: true,
      resource,
      settlement: settlement.success
        ? { ok: true, txHash: settlement.transaction }
        : { ok: false, reason: "nonce-already-used" },
    };
  }
}
