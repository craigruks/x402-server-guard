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

### A distributed store must have a genuine compare-and-set

The in-memory store is atomic because a synchronous JavaScript body runs to
completion. A store shared across serverless isolates must use a native atomic
compare-and-set: a Durable Object, Redis `SET ... NX`, or a database unique
constraint (permit2 and CoW both rely on exactly this kind of atomic write).
Plain get-then-put stores (Cloudflare Workers KV, S3) are not sufficient: with no
compare-and-set, an `await` sits in the check-to-set gap and reopens the race.
Those adapters are a later chapter, and the store docstring says so.

## Hardening applied to the reservation

Two items from cross-referencing the guard against permit2, CoW, MetaMask
`eth-sig-util`, and Hyperliquid's signing SDK.

### The validity window is enforced in the reserve step

`reserve` refuses an authorization whose window has already closed (`expiresAt <=
now`) and returns an `expired` outcome, which the guard maps to a fail-closed
deny. The window is checked in the same atomic step as the reservation, not a
separate earlier gate. CoW enforces order expiry as a read-time predicate against
a trusted clock at the moment of use
([`orders.rs`](https://github.com/cowprotocol/services/blob/main/crates/database/src/orders.rs)),
and Hyperliquid binds an absolute expiry into the signed action
([`signing.py`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py)).
Splitting the window check from the reservation would reopen a time-of-check/
time-of-use gap for a distributed store. The wired flow's facilitator verifies
the window too; this covers a caller that invokes `reserve` directly.

### Fail closed on store failure

`reserve` returns a `Result`, so a store I/O failure is a value, not a throw. The
guard turns any store error into a `store-unavailable` deny. An unavailable store
denies; it never grants. This keeps a stray `try/catch` in a consumer from
turning a store outage into an accidental grant.

## What is deliberately not adopted

- permit2's nonce bitmap packs many nonces into one storage word because its
  nonce is a structured `uint256`. The EIP-3009 nonce is 32 random bytes, so the
  bitmap layout does not transfer. The principle (one atomic conditional write)
  does, and is what we use.
- Independent signature verification (and the low-s malleability check it would
  need) lives one layer down from the guard. It ships later behind an optional
  adapter, never in the core path, so the core keeps zero runtime dependencies.
