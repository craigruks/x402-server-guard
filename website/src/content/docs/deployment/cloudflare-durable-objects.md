---
title: Cloudflare Durable Objects
description: Back the guard with a Durable Object so replay protection holds across isolates.
---

The default store, `createMemoryNonceStore`, protects a single process. On Workers,
Vercel, or any autoscaled fleet each isolate holds its own in-memory `Map`, so two
isolates each reserve the same nonce independently and both grant. The reservation has
to live in one place that every isolate agrees on, updated with a genuine atomic
compare-and-set. On Cloudflare, a Durable Object is that place.

## How it works

The adapter routes every nonce to its own Durable Object (`idFromName(nonce)`). A
Durable Object serves one request at a time and holds delivery of other events while a
storage operation to the same object is in flight, so the reserve check-and-set runs
atomically with no lock. That is the compare-and-set the store contract requires, and
it is why concurrent reservations of one nonce resolve to exactly one grant.

## Bind the Durable Object

In `wrangler.jsonc`, bind the class and add a migration for it:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "NONCE_DO", "class_name": "NonceReservationDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["NonceReservationDO"] }]
}
```

## Wire it into the Worker

Export the Durable Object class from your Worker entry, then build the store from the
binding and hand it to `createGuard`:

```ts
import { createGuard, protect, paidResponseCacheDirectives } from "@craigruks/x402-server-guard";
import {
  createDurableObjectNonceStore,
  NonceReservationDO,
} from "@craigruks/x402-server-guard/cloudflare";

export { NonceReservationDO };

interface Env {
  // Type the binding with the class so the reserve/release RPC methods are visible.
  NONCE_DO: DurableObjectNamespace<NonceReservationDO>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const guard = createGuard({ store: createDurableObjectNonceStore(env.NONCE_DO) });

    // Verify with your facilitator first, then protect the route exactly as in the
    // Quickstart. The only change from the default is the store passed to createGuard.
    // ...
    return new Response("see the Quickstart for the full protect() flow");
  },
};
```

The `@craigruks/x402-server-guard/cloudflare` subpath is compiled against workers types
and is the only entry that imports `cloudflare:workers`. The core entry stays free of
Worker globals, so importing the main package from Node is unaffected. A transport
failure (the object is unreachable) becomes a `store-unavailable` deny, so the guard
still fails closed.

## Honest limits

- **Type the binding with the class.** `DurableObjectNamespace<NonceReservationDO>`, not
  a bare `DurableObjectNamespace`. Without the generic the stub has no `reserve`/`release`
  methods and the adapter will not typecheck against it.
- **Storage is not capped the way the memory store is.** The in-memory store enforces a
  hard `maxEntries` backpressure limit; per-nonce Durable Objects cannot share one counter
  (that would reintroduce the global bottleneck this design removes), so there is no
  equivalent cap here. Each reserved nonce holds one small entry until its `validBefore`,
  when a Durable Object alarm reclaims it. A payer who signs many authorizations with a
  far-future `validBefore` can accumulate objects until that expiry. The real bound is
  **rate limiting upstream of the reserve** (per payer or per IP); the payer controls
  `validBefore`, so a short window is not something you can rely on. Reservation runs after
  the facilitator verifies the signature, so only authenticated payers reach it, not
  anonymous traffic.
- **Requires a recent compatibility date.** The adapter uses Durable Object RPC methods
  and SQLite-backed storage; set a `compatibility_date` new enough to support them.
- **One nonce per object is deliberate.** It gives per-nonce atomicity without a global
  lock. It also means the store keys on the nonce alone, so scope the nonce per (chain,
  asset) yourself if one deployment serves several, rather than sharing one namespace.
