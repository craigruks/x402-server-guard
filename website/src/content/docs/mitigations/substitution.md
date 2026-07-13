---
title: Cross-resource substitution
sidebar:
  label: Substitution
---

Ships in PR #18. Research: Free-Riding (Context Binding, I3), also Five Attacks
(binding weakness).

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

## After: bind the nonce to the resource it was first reserved for

The guard records, at reservation time, which resource a nonce was used for. If the
same nonce shows up at a different resource, it is denied with a distinct reason,
`nonce-resource-mismatch`. Because the binding happens at reserve (before settle),
it catches the substitution in the same window the race fix covers.

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

The resource is compared as a plain string, so two spellings of the same resource
must produce the same string: one resource, one key. Bind to the **served** route,
not the resource the client claims in the payload. Only the merchant knows which
parts of the URL matter for pricing, so canonicalizing the key is the caller's job:

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
- **Trailing slash and case.** Normalize `/api` vs `/api/` and case before use.

Tracked in issue #22.

## What proves it

[`test/attacks/cross-resource-substitution.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/cross-resource-substitution.test.ts):
the guarded suite denies the same nonce at a second resource with
`nonce-resource-mismatch`.
