---
title: Duplicate-settlement race and replay
sidebar:
  label: Race & replay
---

Research: Five Attacks (Attack II), also Free-Riding (I4).

## The attack in plain terms

Remember the two facilitator operations: `verify()` is a cheap read ("is this
payment valid and not yet used?") and `settle()` is the slow write that actually
moves the money and marks the payment used. There is a gap in time between them,
because `settle()` has to wait for the blockchain.

A naive server delivers the resource the moment `verify()` passes, and settles
after (or in the background). `verify()` takes no lock. So an attacker sends the
**same** valid payment many times at once:

- All the requests call `verify()` at nearly the same moment.
- The blockchain has not recorded the payment as used yet (settle is still in
  flight), so every `verify()` returns "valid, not used".
- Every request is handed the resource.
- Then the settlements hit the chain. The token contract only lets the **first**
  one consume the nonce; the rest fail with "already used".

The attacker paid once and walked away with as many copies as they sent at once.
This is a classic time-of-check / time-of-use race; the x402-specific part is that
the check (`verify`) and the use (`settle`) are separated by blockchain latency.

**Replay** is the same coin's other side. Sending the payment again *later* is
caught for free, because by then the chain has recorded the nonce as used and
`verify()` fails. The dangerous replay is the concurrent one above, inside the
settlement window. Same bug, same fix.

## Before: the vulnerable server

```ts
// GET /api, the naive way: verify, deliver, then settle.
app.get("/api", async (c) => {
  const payment = c.req.header("X-PAYMENT");
  const verified = await facilitator.verify(payment, requirements);
  if (!verified.ok) return c.json({ error: "invalid payment" }, 402);

  const body = { report: { weather: "sunny", temperature: 70 } }; // handed over NOW
  facilitator.settle(payment, requirements);                       // consumed LATER
  return c.json(body, 200);
});
```

Fire five concurrent `GET /api` with one `X-PAYMENT`: five reports out, one payment
in. Four free.

## After: reserve the nonce before delivering

The fix is to stop waiting on the slow chain to serialize the payment and instead
reserve the nonce in your own store, atomically, the instant the request arrives.
The first caller to reserve a nonce wins; every concurrent or replayed caller for
that same nonce is denied immediately.

```ts
app.get("/api", async (c) => {
  const payment = c.req.header("X-PAYMENT");
  const verified = await facilitator.verify(payment, requirements);
  if (!verified.ok) return c.json({ error: "invalid payment" }, 402);

  const reservation = await guard.reserve({
    nonce: verified.nonce,                    // the payment's unique nonce
    resource: new URL(c.req.url).pathname,    // which resource this is for
    expiresAt: verified.validBefore,          // when the payment expires
  });
  if (!reservation.reserved) {
    return c.json({ error: reservation.reason.code }, 409); // nonce-already-reserved
  }

  const settled = await facilitator.settle(payment, requirements);
  if (!settled.success) return c.json({ error: "settle failed" }, 402);

  return c.json({ report: { weather: "sunny", temperature: 70 } }, 200);
});
```

Now the same five-way flood: the first request reserves the nonce, the other four
get `409 nonce-already-reserved` before anything is delivered. Exactly one grant.

(In the library, `protect()` wraps this whole reserve, settle, deliver order into
one call. See the repo README.)

## Why "atomic" is the load-bearing word

The reservation must not have an `await` between checking whether the nonce is taken
and taking it. If it did, two concurrent requests could both pass the check before
either writes, and both would win, re-opening the race. The in-memory store is safe
because JavaScript runs a synchronous function to completion before handling the
next request, so the check and the set cannot be interrupted. Across multiple
servers you need a real atomic compare-and-set: Redis `SET NX`, a database unique
constraint, or a Cloudflare Durable Object. A plain read-then-write store (Workers
KV, S3) is not enough, because the `await` in the middle re-opens the gap.

## The subtle bit: key on the nonce, not the signature

A signature can be rewritten into a second, different-looking form that is still
valid and still from the same signer (this is called signature malleability). If you
de-duplicated on the signature bytes, an attacker could submit the original and its
rewritten twin and slip a second request through. The nonce lives inside the signed
message and is identical for both forms, so keying on the nonce makes the twin
collide and get denied. That is why the store is keyed on the nonce.

## How this compares to the real x402 reference

This is not only a strawman. The reference `@x402/core` resource server
(`x402HTTPResourceServer`) verifies the payment and returns a `payment-verified`
result with **no** settlement; settlement is a separate `processSettlement` call the
framework makes after the handler runs. `verify` takes no nonce lock and there is no
single-flight, so N concurrent requests carrying one payment all reach
`payment-verified` before any settlement. We reproduce exactly that against the real
class: 20 concurrent requests, 20 verified, 0 settled, then one settlement wins, 19
resources free.

What happens next depends on your framework glue. An adapter that delivers when
`payment-verified` returns (the naive shape) hands out N bodies. An adapter that
buffers the response, settles, and flushes only on success closes the duplicate
*delivery* (one body out), but it still ran your handler N times (any side effects, N
times) and still admitted N requests through verify. Either way the guard closes it at
the front door: an atomic reservation before the handler runs, so exactly one request
proceeds. Two independent papers find this class against Coinbase's official x402 SDKs
(see the [coverage map](/x402-server-guard/reference/coverage-map/) for citations).

## What proves it

- [`test/attacks/duplicate-settlement-race.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/duplicate-settlement-race.test.ts):
  the baseline grants 5 for 1 payment; the guarded test grants exactly 1, and a replay
  is denied.
- [`test/attacks/reference-race.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/reference-race.test.ts):
  the same race against the real `@x402/core` `x402HTTPResourceServer`, with the guard
  reducing a 20-way flood to one grant.
