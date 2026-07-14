---
title: Cross-resource substitution
sidebar:
  label: Substitution
---

Research: Free-Riding (Context Binding, I3), also Five Attacks (binding weakness).

## The attack in plain terms

The signed payment authorizes `{ from, to, value, validAfter, validBefore, nonce }`.
Notice what is missing: it does not say **which resource** the payment is for. The
resource is unsigned metadata the client sends alongside.

So imagine a merchant with two endpoints behind the same wallet at the same price:
`/api/report` (cheap to serve) and `/api/photo` (an expensive original). A payment
is a payment; nothing in it says "this dollar was for the report". An attacker pays
for the cheap one and presents that same payment at the expensive one. A naive
server that only checks "is this a valid, paid-for dollar to my wallet?" says yes,
and hands over the expensive resource.

The payment layer literally cannot tell the two resources apart, because the payer
never signed which one they meant.

## Before: the vulnerable server

```ts
// Both routes accept any valid payment to the merchant wallet.
async function handlePaid(c, deliver) {
  const payment = c.req.header("X-PAYMENT");
  const verified = await facilitator.verify(payment, requirements); // checks $ only
  if (!verified.ok) return c.json({ error: "invalid payment" }, 402);
  await facilitator.settle(payment, requirements);
  return c.json(deliver(), 200);
}

app.get("/api/report", (c) => handlePaid(c, () => ({ report: "..." })));
app.get("/api/photo",  (c) => handlePaid(c, () => ({ photo:  "..." }))); // pay report, take photo
```

## After: one payment, one resource

Be precise about where the protection comes from. The guard's single-use reservation
already prevents one payment being spent at two resources: the second use of a nonce is
denied whichever resource it targets. That is the same mechanism as the replay fix, so
substitution does not need a separate control, and we do not claim it as one.

What the resource binding adds is a *distinct reason*, not a distinct decision. A nonce
first bound to `/api/report` and re-presented at `/api/photo` is denied as
`nonce-resource-mismatch` rather than a plain `nonce-already-reserved`. The grant/deny
outcome is identical either way; the binding only lets you tell a substitution attempt
from an ordinary duplicate in your logs and metrics, so you can respond differently.

```ts
const reservation = await guard.reserve({
  nonce: verified.nonce,
  resource: new URL(c.req.url).pathname, // /api/report vs /api/photo: different keys
  expiresAt: verified.validBefore,
});
if (!reservation.reserved) {
  // nonce-resource-mismatch if this nonce was first bound to another resource
  return c.json({ error: reservation.reason.code }, 409);
}
```

## The honest limits (stated so it is not oversold)

- First-seen binding cannot know a payment's *intended* resource, because nothing
  signed says so. A payment's very first use at the "wrong" resource still binds and
  grants there. What it stops is the same payment being spent across *two*
  resources.
- It does not stop a payer front-running their own payment onto a costlier route on
  its first use.
- A different price or a different destination wallet is already caught by the
  facilitator's normal checks; the guard covers the equal-price, same-wallet case
  those checks cannot.

## The canonical-key obligation

The resource is compared as a canonical key, so two spellings of the same resource
must produce the same string: one resource, one key. The guard folds the parts that
are never semantic for you (a URL's scheme and host casing, and the default port);
the parts below stay your job, because only the merchant knows which of them matter
for pricing. Bind to the **served** route, not the resource the client claims:

- **Query string.** If the query distinguishes two separately-priced resources
  (`/api?file=a` vs `/api?file=b`), fold the relevant query into the key, or a nonce
  bound at one value is accepted at the other.
- **Host / www.** Using the path alone folds `www.example.com/api` and
  `example.com/api` into one key, which is correct when both serve the same app (the
  usual case). Only if you serve *different paid content* on different hosts at the
  *same path* do you need the host in the key.
- **Redirects.** These do not open a hole: you reserve and deliver in the same
  handler on the same final URL, and a 301/302 carries no paid body. The only risk is
  a false *deny* if a normalizer rewrites the path between reserve and deliver, so run
  the key function on the actually-served request and keep it stable.
- **Trailing slash.** Normalize `/api` vs `/api/` before use (the guard folds URL
  scheme and host case, but not the path).

The guard applies this key folding by default; a case- or prefix-sensitive scope can
opt out with `GuardOptions.canonicalizeResource` / `canonicalizeNonce`.

## What proves it

[`test/attacks/cross-resource-substitution.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/cross-resource-substitution.test.ts):
the guarded suite denies the same nonce at a second resource with
`nonce-resource-mismatch`.
