---
title: Quickstart
description: Install the guard and protect a paid route end to end with protect().
---

This page wires the guard into a paid route in one pass. It mirrors
[`examples/hono-server.ts`](https://github.com/craigruks/x402-server-guard/blob/main/examples/hono-server.ts)
in the repo. Read [Understanding x402](/x402-server-guard/getting-started/understanding-x402/)
first if the `402` flow and the `verify` vs `settle` gap are new to you.

## Install

```sh
npm install @craigruks/x402-server-guard
```

Node ≥ 22. Zero runtime dependencies. Ships ESM with type declarations; a
TypeScript or JavaScript consumer both import the same build.

## Protect a route with `protect()`

`protect()` runs the whole secure flow (`reserve → settle → (confirm) → deliver`) and
returns the cache directives on grant, releasing the reservation if the settle fails
or finality is not reached. It takes plain callbacks, so it drops into any framework.
Verify the payment first (with the facilitator), then hand the authenticated nonce
and the **served** route to `protect()`:

```ts
import { createGuard, paidResponseCacheDirectives, protect } from "@craigruks/x402-server-guard";

const guard = createGuard();

app.get("/api", async (c) => {
  const payment = c.req.header("X-PAYMENT");
  if (payment === undefined) {
    return c.json({ error: "payment required" }, 402);
  }

  // Verify first. A real server calls the facilitator here.
  const verified = facilitator.verify(payment);
  if (!verified.ok) {
    return c.json({ error: "invalid payment" }, 402);
  }

  // Bind the nonce to the SERVED route (the request path), not a client-claimed
  // resource. protect runs reserve -> settle -> deliver and returns cache directives.
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
      // Grant on settle success; finality rests with the facilitator and the chain.
      // Use `finality: "confirm"` with a `confirm()` callback to hold for k confirmations.
      finality: "facilitator",
    },
  );

  if (!decision.granted) {
    return c.json({ error: decision.reason.code }, 409);
  }

  c.header("Cache-Control", decision.cacheControl); // "no-store, private"
  c.header("Vary", paidResponseCacheDirectives().vary);
  return c.json(decision.resource);
});
```

The first request for a nonce wins; a replay or a concurrent race is denied as
`nonce-already-reserved`. The decision is a value, never a throw, so a stray
`try/catch` cannot turn a deny into an accidental grant. Applying `Cache-Control`
to the response keeps a shared cache from serving the paid body to unpaid clients.

## Choosing a finality posture

`finality` is required, on purpose: granting before a payment is final is a security
decision, not a default to fall into. Settling is not the same as final, because a
chain reorg can still reverse a just-settled payment.

- `finality: "facilitator"` grants as soon as the settle succeeds; finality then
  rests with the facilitator and the chain. Right for a single-sequencer L2 like
  Base, where reorgs are rare and hard to force.
- `finality: "confirm"` holds the grant until your `confirm()` callback resolves
  `true` (the settlement reached the confirmations you require). A `confirm` that
  rejects or resolves `false` releases the reservation and denies with `not-final`,
  so the payer can retry.

Leave `finality` off and the guard fails closed (it withholds the grant), so a
forgotten posture never silently grants at zero confirmations.

## Reading the deny reason

A denial carries a typed `code` you branch on:

- `nonce-already-reserved`: a replay or a concurrent race.
- `nonce-resource-mismatch`: the payment was first bound to a different resource (a
  substitution attempt).
- `nonce-expired`: the payment's window has closed.
- `store-at-capacity`: the store is full; back off and retry.
- `store-unavailable`: the store is down (a real outage).

## What each part covers

- Reserving before delivering closes the
  [duplicate-settlement race and replay](/x402-server-guard/mitigations/race-and-replay/).
- Binding the nonce to the served route closes
  [cross-resource substitution](/x402-server-guard/mitigations/substitution/).
- Setting `finality: "confirm"` (with a `confirm()` callback) holds to k confirmations
  for [grant-before-finality](/x402-server-guard/mitigations/finality/).
- Setting `Cache-Control` closes
  [cache leakage](/x402-server-guard/mitigations/cache-leakage/).
