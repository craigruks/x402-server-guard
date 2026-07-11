/**
 * The naive, unguarded x402 resource server — the exploitable baseline every
 * attack reproduction fires against.
 *
 * Its single load-bearing flaw is optimistic delivery: it releases the resource
 * as soon as the facilitator reports the payment valid, BEFORE settlement
 * confirms on-chain. Nothing binds a payment to a single grant. This is the
 * pattern the research shows a straightforward integrator writes, and it is
 * what our guard exists to close.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { GrantResult } from "./types.js";

export class BaselineResourceServer<TResource> {
  constructor(
    private readonly facilitator: FacilitatorClient,
    private readonly deliver: (requirements: PaymentRequirements) => TResource,
  ) {}

  /** Handle one paid request. Returns whether the resource was granted. */
  async handle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<GrantResult<TResource>> {
    const verification = await this.facilitator.verify(payload, requirements);
    if (!verification.isValid) {
      return { granted: false };
    }

    // FLAW: deliver first, settle second. A concurrent or replayed request that
    // clears verification before this one settles is also granted.
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
