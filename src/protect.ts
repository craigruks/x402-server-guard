/**
 * The secure flow as one call: reserve, settle, confirm, grant.
 *
 * `protect` is the framework-agnostic "wrap your endpoint" core. A merchant
 * verifies the payment with their facilitator first (signature, amount, window),
 * then calls `protect` with the payment's nonce, the resource being served, and
 * callbacks to settle and deliver. It runs the safe order:
 *
 *   reserve -> settle -> (confirm finality) -> deliver
 *
 * and closes all four attack classes at once: the atomic reservation stops the
 * duplicate-settlement race and payment replay; the resource on the reservation
 * stops cross-resource substitution; settling before delivering plus the optional
 * `confirm` gate stops grant-before-finality; and a granted response carries the
 * `Cache-Control` that keeps a shared cache from leaking it. A settlement that
 * fails, or a finality gate that is not met, releases the reservation so the payer
 * can retry the same authorization.
 *
 * It has no runtime dependencies and does not know about any HTTP framework or
 * about `@x402/core`: the caller passes plain callbacks. A Hono, Express, or
 * `@x402/core`-hook binding is a thin wrapper that supplies those callbacks.
 * Verify BEFORE calling `protect`; the nonce it reserves must be the one the
 * facilitator authenticated (see the malleability note in the nonce store).
 */
import { paidResponseCacheDirectives } from "./cache.js";
import { type GuardError, guardError } from "./error.js";
import type { Guard, GuardErrorCode } from "./guard.js";
import type { ReserveParams } from "./nonce-store.js";

/** Why a `protect` call did not grant: a guard deny, a failed settle, or non-finality. */
export type ProtectDenyReason = GuardErrorCode | "settle-failed" | "not-final";

export interface ProtectHandlers<TResource> {
  /** Settle the payment through your facilitator. Resolve `true` iff it settled. */
  settle(): Promise<boolean>;
  /** Deliver the resource once the payment is safe to grant. */
  deliver(): TResource | Promise<TResource>;
  /**
   * Optional finality gate: resolve `true` once the settlement has reached the
   * confirmations you require for this chain. Omit it to grant on settle success
   * (finality then rests with the facilitator and the chain).
   */
  confirm?(): Promise<boolean>;
}

/** The decision `protect` returns: granted with the resource, or denied with a reason. */
export type ProtectDecision<TResource> =
  | { readonly granted: true; readonly resource: TResource; readonly cacheControl: string }
  | { readonly granted: false; readonly reason: GuardError<ProtectDenyReason> };

/**
 * Run the guarded secure flow for one already-verified payment. `request` is the
 * reservation input (the authenticated nonce, the served resource as a canonical
 * key, and the authorization's `validBefore` as `expiresAt`).
 */
export async function protect<TResource>(
  guard: Guard,
  request: ReserveParams,
  handlers: ProtectHandlers<TResource>,
): Promise<ProtectDecision<TResource>> {
  const reservation = await guard.reserve(request);
  if (!reservation.reserved) {
    return { granted: false, reason: reservation.reason };
  }

  const settled = await handlers.settle();
  if (!settled) {
    // The payment did not settle: free the nonce so the payer can retry it.
    await reservation.release();
    return { granted: false, reason: guardError("settle-failed", "payment did not settle") };
  }

  if (handlers.confirm !== undefined) {
    const final = await handlers.confirm();
    if (!final) {
      // Settled but reorged or not yet buried to finality: release and withhold.
      await reservation.release();
      return { granted: false, reason: guardError("not-final", "settlement not final") };
    }
  }

  return {
    granted: true,
    resource: await handlers.deliver(),
    cacheControl: paidResponseCacheDirectives().cacheControl,
  };
}
