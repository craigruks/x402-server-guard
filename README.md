# x402-server-guard

**Server-side hardening middleware for [x402](https://github.com/coinbase/x402)
payment endpoints.**

x402 lets a server charge for a resource by returning `402 Payment Required` and
verifying a signed payment. Published research has shown that a naïve resource
server is exploitable in several ways: a payment can be replayed, reused against
a different resource, raced to duplicate delivery before settlement confirms, or
leaked to unpaid clients through a shared cache. This library is the enforcement
layer a merchant wraps their endpoint in to close those gaps.

> [!WARNING]
> **Status: early, pre-1.0.** The duplicate-settlement race and payment replay
> mitigation is implemented; the remaining classes below are still in progress. It
> is **not audited** and is **not a security guarantee**. Do not treat the current
> coverage as complete; see the mitigation table below for what is and is not done.

## Security disclaimer

This software is provided **"AS IS"**, without warranty of any kind. It is **not
audited** and is **not a security guarantee**. It mitigates specific, enumerated
attack classes only. It cannot make an insecure payment endpoint safe on its own.
**The authors accept no liability for any loss of funds or damages.** See
[SECURITY.md](./SECURITY.md) and the [LICENSE](./LICENSE).

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

The reservation defaults to an in-memory store (single process). A store shared
across serverless isolates needs a genuine atomic compare-and-set; see
[`docs/hardening.md`](./docs/hardening.md). The one-call framework adapters
(Express, Hono, Next, Fastify) land in a later chapter; for now this is the
pattern to wire into a hand-rolled handler.

A runnable version, including the concurrent race it blocks, is in
[`examples/secure-flow.ts`](./examples/secure-flow.ts) (`npx tsx
examples/secure-flow.ts`).

This closes the duplicate-settlement race and payment replay. The other
mitigations are still in progress; see the table below.

## Design principles

- **Zero runtime dependencies.** The core relies only on Node's built-in `crypto`.
  Every dependency is attack surface; a hardening library should have as little of
  it as possible. Independent signature verification (which needs cryptographic
  primitives) will ship later behind an optional adapter, never in the core path.
- **Installs clean under npm v12's hardened defaults**: no lifecycle scripts, no
  `npm approve-scripts` step, nothing to allow.
- **Small enough to read.** Source files are capped so the whole library can be
  audited in an afternoon. Built with plain `tsc` so the published output maps
  one-to-one to the source you can see.
- **Plugs into the official `@x402/core` lifecycle hooks** rather than patching
  internals. The same guard covers Express, Hono, Next, and Fastify.

## Planned mitigations

Each will land with a paired test proving the attack against a vanilla server and
proving it blocked by the guard.

| Attack class | Status |
| --- | --- |
| Duplicate-settlement race | done |
| Payment replay | done (same nonce reservation) |
| Cross-resource substitution | planned |
| Cache leakage of paid content | planned |
| Grant-before-finality (k-confirmations) | planned |

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
