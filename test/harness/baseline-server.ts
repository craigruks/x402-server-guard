/**
 * The naive, unguarded x402 resource server: the exploitable baseline every
 * attack reproduction fires against.
 *
 * It carries the flaws the research shows a straightforward integrator writes:
 *   1. Optimistic delivery: it releases the resource as soon as the facilitator
 *      reports the payment valid, BEFORE settlement confirms on-chain. Nothing
 *      binds a payment to a single grant.
 *   2. No resource binding: nothing ties a payment to the resource it is spent
 *      on. The EIP-3009 authorization does not sign the resource, so equally
 *      priced resources behind one payTo are indistinguishable at the payment
 *      layer. Telling them apart is server-side state the baseline does not keep.
 *
 * Closing both is what the guard exists to do.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { GrantResult } from "./types.js";

export class BaselineResourceServer<TResource> {
  constructor(
    private readonly facilitator: FacilitatorClient,
    private readonly deliver: (requirements: PaymentRequirements) => TResource,
    /**
     * The resource this endpoint serves. There is no trustworthy binding from a
     * payment to it: the EIP-3009 authorization does not sign the resource, and
     * `PaymentPayload.resource` is unsigned client metadata, so comparing the two
     * proves nothing. Nothing finer than the signed payTo/value distinguishes
     * resources, so for equally-priced ones behind one payTo the guard binds
     * server-side, tying the payment's nonce to the resource it is first used for.
     * This field is what that binding attaches to.
     */
    readonly resourceUrl?: string,
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
