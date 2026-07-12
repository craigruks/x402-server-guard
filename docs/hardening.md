# Hardening rationale and sources

Why the guard is shaped the way it is, and where each decision comes from. This
document grows one section per mitigation as it lands. Today it covers the
race and replay mitigation (PR: nonce reservation) and the hardening applied to
it.

The claims about this repository's own code are verifiable by running the tests
(`npm run test:coverage`). Claims about external projects link to the source that
was read; where a specific commit was pinned it is named, since those files move.

## Threat model

The attack classes come from published research on x402 resource servers:

- Cross-resource substitution, payment replay, and duplicate-settlement race:
  [arXiv:2605.11781](https://arxiv.org/abs/2605.11781).
- Cache leakage of paid content and grant-before-finality:
  [arXiv:2605.30998](https://arxiv.org/abs/2605.30998).

The reference these attacks apply to is Coinbase's official
[`coinbase/x402`](https://github.com/coinbase/x402) TypeScript resource server. As
surveyed at `main` commit `dd927a2`:

- Replay defense is on-chain only. The EVM facilitator reads
  `authorizationState(from, nonce)` at verify and parses the transfer revert at
  settle (the `exact` EIP-3009 mechanism under
  [`typescript/`](https://github.com/coinbase/x402/tree/dd927a2/typescript)).
  Nothing reserves the nonce off-chain between verify and settle, so N concurrent
  requests carrying one authorization all pass verify before the chain serializes
  them: a time-of-check/time-of-use race.
- The signed authorization binds `{from, to, value, validAfter, validBefore,
  nonce}` and the token contract (via the EIP-712 domain), but not the resource.
  A signature valid for route A is valid for route B at the same price and payTo.
- No adapter sets `Cache-Control` or `Vary` on the 402 or the paid 200.

## Race and replay: atomic nonce reservation

The guard reserves a payment's nonce before granting. The first request for a
nonce wins; a replay or a concurrent race is denied. This closes the race by
making the check and the reservation a single atomic step, so there is no window
between "is this nonce free?" and "take it".

### The nonce is the replay primitive, and we key on it

Replay protection keys on the EIP-3009 nonce, never on the signature bytes.
Established off-chain-signature systems do the same, because the nonce is the
identity the signature authorizes, not the signature encoding:

- Uniswap permit2 tracks single-use nonces in an on-chain bitmap keyed by
  `(owner, nonce)`, consumed with an atomic flip-and-check, never by signature
  ([`SignatureTransfer.sol`](https://github.com/Uniswap/permit2/blob/main/src/SignatureTransfer.sol),
  `_useUnorderedNonce`).
- CoW Protocol dedupes signed orders by a content-derived order UID using a
  database unique constraint, not the signature
  ([`orders.rs`](https://github.com/cowprotocol/services/blob/main/crates/database/src/orders.rs)).

Keying on the nonce is also what makes replay protection immune to signature
malleability. An ECDSA signature `(r, s, v)` has a second form `(r, N-s, v^1)`
that recovers the same signer but is a different byte string. A store keyed on
signature bytes would see two distinct entries and let the malleated twin
through. Keyed on the signed nonce, both forms carry the same nonce and collide.
This matters because common EIP-712 verifiers do not reject the high-s form:
[`@metamask/eth-sig-util`](https://github.com/MetaMask/eth-sig-util/blob/main/src/sign-typed-data.ts)'s
`recoverTypedSignature` validates the recovery id but not low-s, leaving that
check to the caller. We sidestep the question by never keying on the signature.

This immunity is joint with signature verification. The guard keys on the nonce
the facilitator authenticated, because verify runs before reserve; a caller that
reserves without first verifying keys on an unauthenticated, attacker-chosen
nonce. And a distinct nonce is a distinct authorization that settles its own
on-chain transfer: paying again with a fresh nonce is paying twice, not a
double-spend, and is correctly out of scope.

### A distributed store must have a genuine compare-and-set

The in-memory store is atomic because a synchronous JavaScript body runs to
completion. A store shared across serverless isolates must use a native atomic
compare-and-set: a Durable Object, Redis `SET ... NX`, or a database unique
constraint (permit2 and CoW both rely on exactly this kind of atomic write).
Plain get-then-put stores (Cloudflare Workers KV, S3) are not sufficient: with no
compare-and-set, an `await` sits in the check-to-set gap and reopens the race.
Those adapters are a later chapter, and the store docstring says so. The
compare-and-set closes the double-spend race on its own. Refusing an
already-expired authorization atomically with it needs a Lua script or a
constraint that encodes the expiry, not bare `SET NX`; treating the expiry as a
separate predicate before the CAS is acceptable, since it only races `now`
crossing a fixed `validBefore` and the on-chain check is the backstop.

## Hardening applied to the reservation

Two items from cross-referencing the guard against permit2, CoW, MetaMask
`eth-sig-util`, and Hyperliquid's signing SDK.

### The closing edge of the window is enforced in the reserve step

`reserve` refuses an authorization whose window has already closed (`expiresAt <=
now`) and returns an `expired` outcome, which the guard maps to a fail-closed
deny. Only the closing edge is checked here; the opening edge (`validAfter`) is
the facilitator's job, and the facilitator re-checks both edges anyway. CoW
enforces order expiry as a read-time predicate against a trusted clock at the
moment of use
([`orders.rs`](https://github.com/cowprotocol/services/blob/main/crates/database/src/orders.rs)),
and Hyperliquid binds an absolute expiry into the signed action
([`signing.py`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py)).
In the in-memory store the check shares the reservation's atomic tick; on a
distributed store it may be a separate predicate before the compare-and-set (see
above). This covers a caller that invokes `reserve` directly; the wired flow's
facilitator verifies the window too.

### Fail closed on store failure

`reserve` returns a `Result`, so a store failure is a value. But a distributed
adapter (Redis, a Durable Object) rejects its promise on an I/O failure rather
than returning one, so the guard wraps the store call in `tryCatchAsync`: a
thrown or rejected store becomes a `store-unavailable` deny too, not an uncaught
rejection. An unavailable store denies; it never grants. This keeps the
fail-closed guarantee from being delegated, unenforced, to every adapter author.

### Bounding memory

The store evicts expired reservations, but `expiresAt` is the attacker-signed
`validBefore`, so the sweep alone does not bound memory: a flood of far-future
authorizations is retained. A hard `maxEntries` cap makes a fresh reservation
past the ceiling fail closed, rather than growing without bound or evicting a
live entry (which would reopen the race). Peak retention is roughly
`min(maxEntries, request_rate * validBefore_horizon)`; there is no claim of an
unconditional bound.

## Cross-resource substitution

Source: [arXiv:2605.11781](https://arxiv.org/abs/2605.11781) (§ substitution).

An EIP-3009 authorization signs `{from, to, value, validAfter, validBefore,
nonce}` and, via the EIP-712 domain, the token and chain. It does **not** sign
the resource, and `PaymentPayload.resource` is unsigned client metadata. So two
resources behind one `payTo` at the same price are indistinguishable at the
payment layer: a payment can be redeemed at a resource the payer did not intend.
The reference server matches only `{scheme, network, asset, amount, payTo}`
(surveyed above), so it has no binding to fall back on.

The guard binds the nonce to the resource it is **first reserved for**, and
denies the same nonce at a different resource with a distinct
`nonce-resource-mismatch` (not the generic `nonce-already-reserved`). Because the
binding happens at reserve, before settle, it catches the substitution in the
window the on-chain nonce is not yet consumed, where the facilitator's post-settle
nonce check cannot help. The resource is compared as a canonical key, so callers
must normalize it (trailing slash, query order, case) before passing it in.

Honest limits, stated so the mitigation is not oversold:
- First-seen binding cannot know a payment's *intended* resource (nothing signed
  says so). A payment's very first use at the "wrong" resource still binds and
  grants there. It stops the same nonce being spent across *two* resources, and
  flags the attempt; it does not divine intent.
- It does not stop a payer front-running their own nonce onto a costlier route.
  Real intent-binding needs the resource inside what the facilitator verifies,
  which the exact scheme's fixed six-field signature cannot carry.
- A different price or `payTo` is already caught by the facilitator's parameter
  matching; the guard covers the equal-price, same-`payTo` case it cannot.

## Grant-before-finality

Source: [arXiv:2605.30998](https://arxiv.org/abs/2605.30998) (§ finality).

A facilitator's `settle` reporting success means the payment landed in a block, not
that it is final. Until it is buried under enough confirmations a chain reorg can
drop it and revert the payment, so a server that grants at zero confirmations can
deliver a resource against a payment that never sticks.

The guard does not watch the chain; the merchant's server (or the adapter) holds
the grant until the settlement reaches k confirmations, where k is a per-chain
setting (an L2 sequencer's finality differs from PoW/PoS k-confirmations). What the
guard adds is the primitive that makes the hold safe to abandon: `reserve` returns
a handle with `release`, so if the settlement fails or is reorged before finality
the server frees the nonce and the payer can retry the same authorization instead
of being locked out until the window closes.

`release` is fenced by a token held inside the handle: only the reserver can free
its own hold, so it is not a griefing primitive an attacker can aim at another
payer's in-flight reservation. Not calling `release` is safe: the reservation
simply expires with the authorization. Freeing a hold whose settlement did not
stick does not reopen the race, because the payment was never granted; releasing a
successful reservation is what would, and the flow never does that.

On a single-sequencer L2 like Base (x402's usual home) reorgs are rare and hard to
force; elsewhere the risk is higher. The mitigation is the discipline of holding
until finality plus the release-on-failure retry path, not a claim that reorgs are
impossible.

## Cache leakage of paid content

Source: [arXiv:2605.30998](https://arxiv.org/abs/2605.30998) (§ cache).

A shared cache (CDN or reverse proxy) in front of the resource server keys on the
request URL and knows nothing about payment. If a paid 200 is cacheable, the cache
stores it and serves it to the next caller for that URL, paid or not: the content
leaks for free. The reference x402 adapters set no cache directive on the paid
response (surveyed above: no `Cache-Control`, no `Vary`), so a shared cache is free
to store it.

Unlike the other three, this is not a decision about a nonce; it is a response
directive. `paidResponseCacheDirectives()` returns `Cache-Control: no-store,
private` and a `Vary` on the payment header, which the server or adapter attaches
to every paid response. `no-store` is load-bearing: any HTTP-conformant cache
refuses to store it. `private` and `Vary` are defense in depth for a cache that
stores anyway. The framework binding applies these headers; the `protect` helper
returns them on a granted decision so the caller does not have to remember to.

## Wiring it together: `protect`

The four mitigations compose in one framework-agnostic call, `protect`, which runs
the safe order `reserve -> settle -> confirm -> deliver` and returns the cache
directives on grant, releasing the reservation if the settle fails or finality is
not reached. It has no runtime dependencies and takes plain callbacks, so a Hono,
Express, or `@x402/core`-hook binding is a thin wrapper over it. The binding lives
at the HTTP layer because the served resource (the request URL) is only available
there, and binding the nonce to the served route, not the unsigned resource the
payer claims, is what makes the substitution mitigation sound. See
`examples/hono-server.ts`.

## What is deliberately not adopted

- permit2's nonce bitmap packs many nonces into one storage word because its
  nonce is a structured `uint256`. The EIP-3009 nonce is 32 random bytes, so the
  bitmap layout does not transfer. The principle (one atomic conditional write)
  does, and is what we use.
- Independent signature verification (and the low-s malleability check it would
  need) lives one layer down from the guard. It ships later behind an optional
  adapter, never in the core path, so the core keeps zero runtime dependencies.
