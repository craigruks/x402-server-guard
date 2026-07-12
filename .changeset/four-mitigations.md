---
"@craigruks/x402-server-guard": minor
---

First release with mitigations. Covers all four enumerated x402 resource-server
attack classes:

- Duplicate-settlement race and payment replay: atomic nonce reservation before
  grant (`createGuard`, `MemoryNonceStore`), fail-closed on store failure, memory
  bounded by a `maxEntries` cap and expiry sweep.
- Cross-resource substitution: the nonce is bound to the resource it is first
  reserved for; a mismatch denies with `nonce-resource-mismatch`.
- Grant-before-finality: `reserve` returns a handle with a token-fenced `release`,
  so a server can hold the grant to k confirmations and free the nonce (for a
  retry) if the settlement fails or reorgs.
- Cache leakage: `paidResponseCacheDirectives()` returns the `no-store, private`
  and `Vary` headers that keep a shared cache from serving paid content onward.

`protect()` composes all four into one framework-agnostic call
(`reserve -> settle -> confirm -> deliver`) with no runtime dependencies.
Verified with the mitigation reproductions and 100% coverage; see
`docs/coverage-map.md` and `docs/hardening.md`.
