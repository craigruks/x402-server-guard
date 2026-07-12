/**
 * The secure flow: how to put the guard in front of an x402 payment.
 *
 * This shows the guard's decision flow with a STUB standing in for x402's
 * facilitator (the verify/settle calls). The point is to show exactly where the
 * reservation slots into your own handler: verify -> reserve -> settle -> grant.
 * The one-call framework adapter that wires this into a real `@x402/core`
 * endpoint (Hono first) is the next chapter; until then this is the pattern to
 * copy into a hand-rolled handler.
 *
 * Scope: this closes the duplicate-settlement race and payment replay. The other
 * mitigations (cross-resource substitution, cache leakage, grant-before-finality)
 * land in later chapters.
 *
 * Run it: `npx tsx examples/secure-flow.ts`
 */

// A consumer imports the package name; in-repo we import the source directly.
import { createGuard } from "../src/index.js";

// --- The stub facilitator (stands in for @x402's verify/settle) -------------
// verify() always passes here. settle() consumes the nonce exactly once, the way
// the on-chain transferWithAuthorization does: the first settle wins, later
// settles of the same nonce fail. This is the behavior the race exploits.
const settledNonces = new Set<string>();
const facilitator = {
  verify: async (): Promise<{ ok: true }> => ({ ok: true }),
  settle: async (nonce: string): Promise<{ ok: boolean }> => {
    if (settledNonces.has(nonce)) {
      return { ok: false }; // nonce already used on-chain
    }
    settledNonces.add(nonce);
    return { ok: true };
  },
};

// A payment carries the fields the guard needs: the nonce and the authorization's
// validBefore (unix seconds). resource is which endpoint this payment is for.
interface Payment {
  nonce: string;
  validBefore: number;
  resource: string;
}

const guard = createGuard();

/** Handle one paid request the secure way: reserve, settle, then grant. */
async function handle(payment: Payment): Promise<{ granted: boolean; reason?: string }> {
  // 1. Verify the payment (signature, amount, window) with the facilitator.
  const verified = await facilitator.verify();
  if (!verified.ok) {
    return { granted: false, reason: "verify failed" };
  }

  // 2. Reserve the nonce BEFORE granting. The first request for a nonce wins; a
  //    replay or a concurrent race is denied here, atomically.
  const reservation = await guard.reserve({
    nonce: payment.nonce,
    resource: payment.resource,
    expiresAt: payment.validBefore,
  });
  if (!reservation.reserved) {
    return { granted: false, reason: reservation.reason.code };
  }

  // 3. Settle BEFORE granting. A payment that fails to settle yields no resource.
  const settled = await facilitator.settle(payment.nonce);
  if (!settled.ok) {
    return { granted: false, reason: "settle failed" };
  }

  // 4. Only now deliver the resource.
  return { granted: true };
}

// --- Demonstration ----------------------------------------------------------
const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
const payment: Payment = {
  nonce: `0x${"ab".repeat(32)}`,
  validBefore: oneHourFromNow,
  resource: "https://api.example.com/report",
};

// Fire five concurrent requests carrying the SAME payment: the race.
const flood = await Promise.all(Array.from({ length: 5 }, () => handle(payment)));
const granted = flood.filter((r) => r.granted).length;
const denied = flood.filter((r) => !r.granted);

console.log(`concurrent flood of one payment -> granted ${granted} of 5`);
console.log(
  `denied reasons:`,
  denied.map((r) => r.reason),
);

if (granted !== 1) {
  throw new Error(`expected exactly one grant, got ${granted}`);
}
console.log("OK: the guard held delivery to a single grant.");
