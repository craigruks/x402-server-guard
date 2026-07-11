# x402-server-guard

**Server-side hardening middleware for [x402](https://github.com/coinbase/x402)
payment endpoints.**

x402 lets a server charge for a resource by returning `402 Payment Required` and
verifying a signed payment. Published research has shown that a naïve resource
server is exploitable in several ways — a payment can be replayed, reused against
a different resource, raced to duplicate delivery before settlement confirms, or
leaked to unpaid clients through a shared cache. This library is the enforcement
layer a merchant wraps their endpoint in to close those gaps.

> [!WARNING]
> **Status: v0.1 scaffold.** This release establishes the toolchain, packaging,
> and trust surface only. **No mitigations are implemented yet.** Do not depend on
> it for protection. Follow the repository for the attack reproductions and fixes
> landing next.

## Security disclaimer

This software is provided **"AS IS"**, without warranty of any kind. It is **not
audited** and is **not a security guarantee**. It mitigates specific, enumerated
attack classes only — it cannot make an insecure payment endpoint safe on its own.
**The authors accept no liability for any loss of funds or damages.** See
[SECURITY.md](./SECURITY.md) and the [LICENSE](./LICENSE).

## Design principles

- **Zero runtime dependencies.** The core relies only on Node's built-in `crypto`.
  Every dependency is attack surface; a hardening library should have as little of
  it as possible. Independent signature verification (which needs cryptographic
  primitives) will ship later behind an optional adapter, never in the core path.
- **Installs clean under npm v12's hardened defaults** — no lifecycle scripts, no
  `npm approve-scripts` step, nothing to allow.
- **Small enough to read.** Source files are capped so the whole library can be
  audited in an afternoon. Built with plain `tsc` so the published output maps
  one-to-one to the source you can see.
- **Plugs into the official `@x402/core` lifecycle hooks** rather than patching
  internals — the same guard covers Express, Hono, Next, and Fastify.

## Planned mitigations

Each will land with a paired test proving the attack against a vanilla server and
proving it blocked by the guard.

| Attack class | Status |
| --- | --- |
| Cross-resource substitution | planned |
| Payment replay | planned |
| Duplicate-settlement race | planned |
| Cache leakage of paid content | planned |
| Grant-before-finality (k-confirmations) | planned |

## License

[MIT](./LICENSE) © Craig Ruks
