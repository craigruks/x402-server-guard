---
title: Grant-before-finality
sidebar:
  label: Finality
---

Ships in PR #19. Research: Five Attacks (Attack I-A, revert-grant under optimistic
execution).

## The attack in plain terms

When `settle()` reports success, it means the payment landed in a block, not that it
is permanent. Blockchains can briefly reorganize: a block that looked final gets
dropped and replaced, and any payment in it is reversed, as if it never happened.
The rule of thumb is to wait for k additional blocks ("k confirmations") before
treating a payment as final, because a reorg deep enough to undo k blocks is
exponentially unlikely.

A server that grants the resource the instant `settle()` returns is granting at zero
confirmations. An attacker who can cause or exploit a reorg gets the resource, then
has the payment reversed, and keeps the goods for free.

## Before: the vulnerable server

```ts
const settled = await facilitator.settle(payment, requirements);
if (settled.success) {
  return c.json(deliver(), 200); // granted at 0 confirmations; a reorg reverses the pay
}
```

## After: hold to k confirmations, and release cleanly on failure

The guard does not watch the chain itself; the merchant (or an adapter) waits for k
confirmations. What the guard adds is the primitive that makes the wait safe to
abandon: the reservation hands back a `release`, so if the payment fails to finalize
or is reorged, the server frees the nonce and the payer can retry the same
authorization instead of being locked out.

```ts
const reservation = await guard.reserve({ nonce, resource, expiresAt });
if (!reservation.reserved) return c.json({ error: reservation.reason.code }, 409);

const settled = await facilitator.settle(payment, requirements);
if (!settled.success) {
  await reservation.release();               // free the nonce for a retry
  return c.json({ error: "settle failed" }, 402);
}

const final = await waitForConfirmations(settled.txHash, k); // k is per-chain
if (!final) {
  await reservation.release();               // reorged: withhold and free for retry
  return c.json({ error: "not final" }, 402);
}

return c.json(deliver(), 200);               // only now is it safe to grant
```

`protect()` runs exactly this order for you when you pass a `confirm()` callback.

## Two safety properties worth understanding

- **The release is fenced.** Only the caller that made a reservation can release it,
  because the reservation carries a private token. An attacker cannot release
  someone else's in-flight reservation to grief them.
- **Releasing after a failed settle is safe.** The payment was never granted and, on
  a reorg, the on-chain nonce is un-consumed, so the same authorization is
  legitimately retryable. Releasing a *successful* grant is what would be unsafe, and
  the flow never does that.

## The honest framing

On a single-sequencer L2 like Base (x402's usual home) reorgs are rare and hard to
force; elsewhere the risk is higher. The mitigation is the discipline of holding to
finality plus a clean retry path, not a claim that reorgs are impossible. How many
confirmations count as "final" is per-chain, and the merchant supplies it; the guard
does not hardcode any chain.

## How this compares to real x402 adapters

This is not a strawman. The mainstream x402 adapters (Express, Hono, and Next's
`withX402`) already buffer the response and settle before flushing any bytes, so
granting *before settle even runs* is already closed there. The naive baseline in
this library's reproduction is deliberately stricter (it grants at zero
confirmations) to isolate the finality question on its own.

The gap those adapters leave is narrower and real: their `settle` waits for an
on-chain receipt, which is roughly one confirmation, not finality. A reorg at shallow
confirmation depth still reverses the payment after the resource was delivered, which
is exactly what a k-confirmation hold closes.

Two related gaps survive buffering and are worth knowing:

- **Side effects run before settlement.** Buffering withholds the response body, not
  the work your handler did. If the route charged a downstream API, sent an email, or
  wrote to a database, that already happened whether or not the payment settled.
- **Not every path gates the body.** Next's `paymentProxy` middleware variant does not
  hold the response at all.

## What proves it

[`test/attacks/grant-before-finality.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/grant-before-finality.test.ts):
the baseline grants before finality and a reorg reverses the payment; the guarded
suite holds to k confirmations and releases the nonce on the reorg.
