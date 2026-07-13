# Review methodology and limits

This library is **not audited** and is **not a security guarantee** (see
[SECURITY.md](../SECURITY.md)). This page is not a trust badge. It states plainly how
the code is reviewed before merge, so the process and its limits are visible, and it
points to where findings actually landed rather than asserting that the code is safe.

## What this is not

- Not an external audit. No third-party firm or named reviewer has signed off on this
  code.
- Not formal verification. There is no machine-checked proof of any property here.
- Not a substitute for your own review. You are wrapping your own payment path; read
  the source (the files are capped small on purpose) and the tests before relying on
  it.

## The lenses applied before merge

Each change is reviewed adversarially, meaning the reviewer tries to make it fail
rather than confirm it works, along three axes.

### 1. TypeScript correctness

The compiler is configured strictly (`strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax`), so a large class of mistakes is a build error rather than a
review note. On top of that, the public type surface is reviewed for the usual
type-design issues: discriminated unions over booleans, narrowed error discriminants,
`unknown` over `any`, and options objects over positional flags. Open items from that
review are tracked in [issue #23](https://github.com/craigruks/x402-server-guard/issues/23).

### 2. Crypto and off-chain-signature best practices

The signature-handling decisions are cross-referenced against established off-chain
authorization systems rather than invented here. The rationale and the specific
sources are in [docs/hardening.md](./hardening.md): Uniswap permit2 and CoW Protocol
(keying replay on the nonce through an atomic conditional write, never on the
signature), MetaMask `eth-sig-util` (why low-s malleability is left to the caller, so
we sidestep it by never keying on signature bytes), and Hyperliquid (binding an
absolute expiry into the authorization). Where a pattern was considered and
deliberately not adopted, that is recorded too.

### 3. Server hardening and fail-closed behavior

The request path is reviewed for fail-open holes: a store that throws or is
unavailable must deny, never grant; an unbounded structure must not be attacker
growable; a thrown callback must not leak a grant. Findings from this axis have
already changed the code, for example the fail-closed wrapping of a throwing store and
the `maxEntries` cap on the in-memory store, and the release-on-throw hardening of
`protect`. The canonical-key contract for nonces and resources is tracked in
[issue #22](https://github.com/craigruks/x402-server-guard/issues/22).

## Where findings land

Findings are not summarized and dropped. They become tracked issues, tests, or code
changes, and each attack class is tied to the test that proves it in
[docs/coverage-map.md](./coverage-map.md). If you find a hole, report it privately per
[SECURITY.md](../SECURITY.md).
