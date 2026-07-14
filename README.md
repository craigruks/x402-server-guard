# x402-server-guard

**Server-side hardening middleware for [x402](https://github.com/coinbase/x402)
payment endpoints.**

Documentation: https://craigruks.github.io/x402-server-guard/

x402 lets a server charge for a resource by returning `402 Payment Required` and
verifying a signed payment. Published research has shown that a naïve resource
server is exploitable in several ways: a payment can be replayed, reused against
a different resource, raced to duplicate delivery before settlement confirms, or
leaked to unpaid clients through a shared cache. This library is the enforcement
layer a merchant wraps their endpoint in to close those gaps.

> [!WARNING]
> **Status: early, pre-1.0.** All four enumerated attack classes below have a
> mitigation implemented. It is **not audited** and is **not a security
> guarantee**; it mitigates these specific classes only and cannot make an insecure
> endpoint safe on its own. See the mitigation table for scope.

## Security disclaimer

This software is provided **"AS IS"**, without warranty of any kind. It is **not
audited** and is **not a security guarantee**. It mitigates specific, enumerated
attack classes only. It cannot make an insecure payment endpoint safe on its own.
**The authors accept no liability for any loss of funds or damages.** See
[SECURITY.md](./SECURITY.md) and the [LICENSE](./LICENSE).

## Install

```sh
npm install @craigruks/x402-server-guard
```

Node ≥ 22. Zero runtime dependencies. Ships ESM with type declarations; a
TypeScript or JavaScript consumer both import the same build.

## Usage

Reserve a payment's nonce through the guard before you grant the resource. The
first request for a nonce wins; a replay or a concurrent race is denied. The
decision is a value, never a throw, so a stray `try/catch` cannot turn a deny
into an accidental grant.

```ts
import { createGuard } from "@craigruks/x402-server-guard";

const guard = createGuard();

// Inside your paid handler, after the facilitator verifies the payment:
const reservation = await guard.reserve({
  nonce: authorization.nonce, // the EIP-3009 nonce
  resource: request.url, // which resource this payment is for
  expiresAt: Number(authorization.validBefore), // unix seconds
});

if (!reservation.reserved) {
  return deny(reservation.reason.code); // e.g. "nonce-already-reserved"
}

// Settle before granting: a payment that fails to settle yields no resource.
const settled = await facilitator.settle(payload, requirements);
if (!settled.success) {
  return deny("settle failed");
}

return grant(resource);
```

> [!WARNING]
> `createGuard()` with no store uses an in-memory store that protects **one process
> only**. On Cloudflare Workers, Vercel, AWS Lambda, or any autoscaled fleet, each
> isolate holds its own map, so replay and race protection do not hold across
> instances. For those deploys, pass a store backed by an atomic compare-and-set: a
> Durable Object, Redis `SET NX`, or a database unique constraint (not a plain
> get-then-put store like Workers KV, which reopens the race). Any backend that
> implements the `NonceStore` contract works. One is built start to finish in the box, a
> Cloudflare Durable Object adapter:
> `import { createDurableObjectNonceStore } from "@craigruks/x402-server-guard/cloudflare"`
> (see [the deployment guide](https://craigruks.github.io/x402-server-guard/deployment/cloudflare-durable-objects/)).
> The atomic compare-and-set contract for other backends is in
> [`docs/hardening.md`](./docs/hardening.md).

### One call: `protect`

`protect` runs the whole secure flow (`reserve → settle → (confirm) → deliver`) and
returns the cache directives on grant, releasing the reservation if the settle
fails or finality is not reached. It has no runtime dependencies and takes plain
callbacks, so it drops into any framework:

```ts
import { protect } from "@craigruks/x402-server-guard";

// After the facilitator verifies the payment:
const decision = await protect(
  guard,
  { nonce, resource: request.url, expiresAt: Number(authorization.validBefore) },
  {
    // settle resolves true only when the payment actually settled.
    settle: async () => (await facilitator.settle(payload, requirements)).success,
    deliver: () => resource,
    // Grant on settle success (finality rests with the facilitator and the chain).
    // Use `finality: "confirm"` with a `confirm()` callback to hold for k confirmations.
    finality: "facilitator",
  },
);
if (!decision.granted) return deny(decision.reason.code);
response.headers.set("Cache-Control", decision.cacheControl);
return grant(decision.resource);
```

Two runnable examples: [`examples/secure-flow.ts`](./examples/secure-flow.ts)
(the concurrent race, blocked) and [`examples/hono-server.ts`](./examples/hono-server.ts)
(a Hono route protected end to end). Bind the nonce to the **served** route (the
request URL), not the payload's claimed resource, which is why the binding lives at
the framework layer.

All four enumerated attack classes are covered; see the table below.

## Design principles

- **Zero runtime dependencies.** The core uses only the Web Platform `crypto` global
  (`crypto.randomUUID`), present on Node 22+, Cloudflare Workers, and Deno, so the guard
  runs in any modern runtime without a polyfill. Every dependency is attack surface; a
  hardening library should have as little of it as possible. Independent signature
  verification would need cryptographic primitives, so it stays out of the core path by
  design; the facilitator verifies payments, and the guard hardens the flow around that.
- **Installs clean under npm v12's hardened defaults**: no lifecycle scripts, no
  `npm approve-scripts` step, nothing to allow.
- **Small enough to read.** Source files are capped so the whole library can be
  audited in an afternoon. Built with plain `tsc` so the published output maps
  one-to-one to the source you can see.
- **Framework-agnostic core.** `protect` takes plain callbacks, so the same guard
  drops into Hono, Express, Next, or Fastify. A Hono binding is shown in the
  examples; an `@x402/core`-hook convenience wrapper is a thin layer over `protect`.

## Mitigations

Each ships with a paired test proving the attack against a vanilla server and
proving it blocked by the guard. Every class is mapped to its research, mechanism,
and proving test in [`docs/coverage-map.md`](./docs/coverage-map.md); the rationale
is in [`docs/hardening.md`](./docs/hardening.md). The hardest questions about scope
and honesty (is this a strawman, does the reference actually have these gaps, what
this does not do) are answered in
[`docs/objection-handling.md`](./docs/objection-handling.md).

| Attack class | Status |
| --- | --- |
| Duplicate-settlement race | done |
| Payment replay | done (same nonce reservation) |
| Cross-resource substitution | done (same nonce reservation, distinct reason) |
| Grant-before-finality (k-confirmations) | done |
| Cache leakage of paid content | done |

## Development

The local toolchain is pinned with [mise](https://mise.jdx.dev):

```sh
mise install   # installs Node (Active LTS) + just from mise.toml
npm ci         # installs the dev toolchain, exact-pinned
just           # lists every repo command
just check     # full local gate: typecheck + lint + file-length + tests
```

Node 24 (Active LTS) is used locally; the published package supports Node ≥22,
and CI tests both. `npm run build` emits the package with plain `tsc`.

Dev tooling lives in `package.json` scripts (`npm run …`); the [`justfile`](./justfile)
is the discoverable index for repo operations that aren't npm: supply-chain
checks, CI, release prep. Run `just` to see them all.

## License

[MIT](./LICENSE) © Craig Ruks
