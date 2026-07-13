/**
 * Guarding a Hono x402 endpoint.
 *
 * This wires the guard into a Hono route with `protect`, the framework-agnostic
 * secure-flow core. Hono is the natural home for the binding because the served
 * resource (the request URL) is available here, and binding the nonce to the
 * served route, not the unsigned resource the payer claims, is what stops
 * cross-resource substitution.
 *
 * A STUB stands in for x402's facilitator (verify/settle). A real handler verifies
 * the EIP-3009 signature, amount, and window with `@x402/core` first, then passes
 * the authenticated nonce and the request path to `protect`. Everything else here
 * is real: the guard, the reservation, the cache directives.
 *
 * Run it: `npx tsx examples/hono-server.ts`
 */

import { Hono } from "hono";
import { createGuard, paidResponseCacheDirectives, protect } from "../src/index.js";

// --- Stub facilitator (stands in for @x402's verify/settle) -----------------
const settledNonces = new Set<string>();
const facilitator = {
  // A real verify authenticates the EIP-3009 signature and returns the signed
  // nonce and validBefore. The stub trusts the header and uses a fixed window.
  verify: (nonce: string) => ({ ok: true, nonce, validBefore: 2_000_000_000 }),
  // settle consumes the nonce once, as the on-chain transfer does.
  settle: async (nonce: string): Promise<boolean> => {
    if (settledNonces.has(nonce)) return false;
    settledNonces.add(nonce);
    return true;
  },
};

const guard = createGuard();
const app = new Hono();

app.get("/report", async (c) => {
  const payment = c.req.header("X-PAYMENT");
  if (payment === undefined) {
    return c.json({ error: "payment required" }, 402);
  }

  // Verify first (stubbed). A real server calls the facilitator here.
  const verified = facilitator.verify(payment);
  if (!verified.ok) {
    return c.json({ error: "invalid payment" }, 402);
  }

  // Bind the nonce to the SERVED route (the request path), not a client-claimed
  // resource. protect runs reserve -> settle -> grant and returns cache directives.
  const decision = await protect(
    guard,
    {
      nonce: verified.nonce,
      resource: new URL(c.req.url).pathname,
      expiresAt: verified.validBefore,
    },
    {
      settle: () => facilitator.settle(verified.nonce),
      deliver: () => ({ report: "paid content" }),
    },
  );

  if (!decision.granted) {
    return c.json({ error: decision.reason.code }, 409);
  }

  c.header("Cache-Control", decision.cacheControl);
  c.header("Vary", paidResponseCacheDirectives().vary);
  return c.json(decision.resource);
});

// --- Demonstration via in-process requests ----------------------------------
const paid = await app.request("/report", { headers: { "X-PAYMENT": "0xNONCE-1" } });
console.log(`paid request -> ${paid.status}, Cache-Control: ${paid.headers.get("Cache-Control")}`);

const replay = await app.request("/report", { headers: { "X-PAYMENT": "0xNONCE-1" } });
const replayBody = (await replay.json()) as { error?: string };
console.log(`replay of the same payment -> ${replay.status}, reason: ${replayBody.error}`);

const unpaid = await app.request("/report");
console.log(`no payment -> ${unpaid.status}`);

if (paid.status !== 200) throw new Error(`expected 200 for a paid request, got ${paid.status}`);
if (paid.headers.get("Cache-Control") !== "no-store, private") {
  throw new Error("paid response must be marked no-store, private");
}
if (replay.status !== 409 || replayBody.error !== "nonce-already-reserved") {
  throw new Error("a replayed payment must be denied as nonce-already-reserved");
}
if (unpaid.status !== 402) throw new Error(`expected 402 without payment, got ${unpaid.status}`);
console.log("OK: paid once, replay denied, unpaid gets 402, paid response is uncacheable.");
