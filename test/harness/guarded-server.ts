/**
 * The baseline resource server with the guard in front: the corrected pattern the
 * attacks are fired at to show them blocked.
 *
 * The secure flow: verify, then run the payment through the library's `protect`
 * (reserve the nonce, settle, release on a failed settle, deliver with the paid
 * cache directives). Delegating to `protect` rather than reimplementing the flow
 * means the attack suites exercise the real shipped path, not a parallel copy.
 * The guard's decision is a value, so a denial is a plain not-granted, not a throw.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Guard } from "../../src/guard.js";
import { protect } from "../../src/protect.js";
import { readExactEvmPayload } from "./payment.js";
import type { GrantResult, SettlementResult } from "./types.js";

export class GuardedResourceServer<TResource> {
  constructor(
    private readonly facilitator: FacilitatorClient,
    private readonly guard: Guard,
    private readonly deliver: (requirements: PaymentRequirements) => TResource,
    readonly resourceUrl: string = "",
  ) {}

  /** Handle one paid request through `protect`: verify, reserve, settle, then grant. */
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

    // `protect` reduces a settle to a boolean; the callback records the on-chain
    // detail (txHash or failure reason) the harness reports back to the tests.
    let settlement: SettlementResult | undefined;
    const decision = await protect(
      this.guard,
      { nonce, resource: this.resourceUrl, expiresAt: Number(validBefore) },
      {
        settle: async () => {
          const result = await this.facilitator.settle(payload, requirements);
          settlement = result.success
            ? { ok: true, txHash: result.transaction }
            : { ok: false, reason: result.errorReason ?? "settle failed" };
          return result.success;
        },
        deliver: () => this.deliver(requirements),
        // Grant at settle success (zero confirmations): the baseline finality
        // posture the grant-before-finality reproduction drives against this server.
        finality: "facilitator",
      },
    );

    if (decision.granted) {
      return {
        granted: true,
        resource: decision.resource,
        cacheControl: decision.cacheControl,
        ...(settlement !== undefined ? { settlement } : {}),
      };
    }
    // A settle that did not stick (protect has already released the hold so the
    // payer can retry). `not-final` cannot arise under the "facilitator" posture.
    if (decision.reason.code === "settle-failed" || decision.reason.code === "not-final") {
      return { granted: false, ...(settlement !== undefined ? { settlement } : {}) };
    }
    // A guard deny: replay, substitution, expiry, or a store failure.
    return { granted: false, denial: decision.reason.code };
  }
}
