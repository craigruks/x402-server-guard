---
title: Cache leakage of paid content
sidebar:
  label: Cache leakage
---

Ships in PR #20 (with `protect()` and the Hono binding). Research: Five Attacks
(Attack III, HTTP / proxy-level handling).

## The attack in plain terms

A shared cache (a CDN or a reverse proxy) sits in front of many servers and remembers
responses by their URL, so the next person asking for that URL gets the stored copy
without the request ever reaching the server. It knows nothing about payment.

If a paid `200` response is cacheable, the cache stores it. The next client that
requests `GET /api`, paid or not, gets served the stored paid content straight from
the cache. The content leaks for free, and the server never even sees the freeloader.

Unlike the first three, this is not about a nonce. It is about one missing response
header.

## Before: the vulnerable response

```ts
return c.json({ report: { weather: "sunny", temperature: 70 } }, 200);
// No Cache-Control. A shared cache is free to store this and serve it to anyone.
```

## After: mark paid responses uncacheable

```ts
import { paidResponseCacheDirectives } from "@craigruks/x402-server-guard";

const { cacheControl, vary } = paidResponseCacheDirectives();
c.header("Cache-Control", cacheControl); // "no-store, private"
c.header("Vary", vary);                  // "X-PAYMENT"
return c.json({ report: { weather: "sunny", temperature: 70 } }, 200);
```

- `no-store` is the load-bearing directive: any cache that obeys HTTP will refuse to
  store the response at all.
- `private` and `Vary: X-PAYMENT` are defense in depth for a cache that stores
  anyway: `private` tells shared caches to keep out, and `Vary` says the response
  depends on the payment header, so it cannot be reused for a different one.

`protect()` returns `cacheControl` on a granted decision, so you do not have to
remember to set it. You still have to apply it to the response; the guard cannot set
a header on a framework it does not know about.

## Other ways to do this, and why we default to no-store

There is more than one way to stop cache leakage. The guard ships the one that is
correct with no setup and fails safe if you do nothing else. The alternatives are
worth knowing, because for large static content they can be better:

- **Capability URLs.** Serve the content at an unguessable path like
  `/download/{long-random-token}`, the way S3 presigned URLs and "anyone with the
  link" document shares work. Now the response *can* be cached, even publicly, because
  the cache is keyed on the token and only ever serves someone who already holds it. Great
  for a large file behind a CDN. The catch: the URL becomes a bearer credential, so it
  leaks through `Referer` headers, logs, and browser history; the token must be long
  and random; and once a CDN caches it you cannot revoke it before its TTL.
- **Signed URLs with an expiry** (CloudFront or S3 signed URLs): capability URLs that
  also expire and cannot be forged. Same bearer trade-off, time-bounded.
- **Per-user cache partitioning**: cache, but never across users (for content that
  differs per user).
- **Encrypt and cache**: cache the scrambled bytes and hand the key to the payer.

These are not competitors with the guard, they are a different layer, and they
compose: run the payment through the guard at the paid route, keep *that* response
`no-store`, then hand back a cacheable capability or signed URL for the actual
delivery. The cache concern just moves to that URL, where being unguessable (and
expiring) does the job that `no-store` did.

We default to `no-store, private` because it is right for the common case (content
served directly at a stable URL, checked on every request) with zero effort, and a
merchant who does nothing else still does not leak.

## The one caveat

A CDN configured to force-cache everything ignores `Cache-Control` entirely. This
mitigation models a cache that honors HTTP, which is the default behavior; if you
deliberately turn on "cache everything", that is on you.

## What proves it

[`test/attacks/cache-leakage.test.ts`](https://github.com/craigruks/x402-server-guard/blob/main/test/attacks/cache-leakage.test.ts):
the baseline serves cached paid content to an unpaid client; the guarded response is
marked `no-store, private` so the shared cache stores nothing.
