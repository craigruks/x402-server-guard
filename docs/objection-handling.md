# Objection handling

We wrote down the hardest questions a skeptical x402 user or security researcher
would ask, and answered them straight. Where the honest answer is "this is narrow"
or "the reference does this on purpose," we say so. If an answer needs detail, it
gets detail; if it is plain, it stays plain.

## Plain questions

### Doesn't the blockchain already stop double-spending? What does this even do?

Yes, the token contract stops the same payment being *settled* twice. Under EIP-3009
a nonce can be consumed on-chain at most once, so a second settlement of the same
authorization reverts. That is real and we rely on it.

What it does not stop is your *server* handing out the paid content several times in
the gap between "this payment looks valid" (verify) and "this payment is settled"
(settle). The x402 reference verifies the payment, lets your handler deliver, and
settles afterward. Fire twenty requests carrying one valid payment at the same
instant: all twenty pass verify (the nonce is not consumed until a settlement lands),
all twenty reach delivery, and only one settlement wins. You were paid once and gave
away the resource twenty times. The guard reserves the nonce atomically at the server,
before delivery, so exactly one of those twenty proceeds.

### Is this just beating a strawman baseline you wrote?

Most of our attack suites do run against a faithful hand-written baseline. But we also
drive the actual `@x402/core` `x402HTTPResourceServer`, the class integrators ship
([`test/attacks/reference-race.test.ts`](../test/attacks/reference-race.test.ts)):
twenty concurrent `processHTTPRequest` calls for one payment all return
`payment-verified` with zero settlements, then exactly one settlement wins, so
nineteen resources are handed out for one payment. Nothing on the grant path is
re-implemented; only the facilitator (through x402's real `FacilitatorClient`
interface) is faked.

It is also not just us. Two independent papers find this class against Coinbase's
official x402 SDKs, one confirming the duplicate-grant against a live testnet endpoint
with on-chain traces. See the coverage map for the citations. So the target is the
real reference plus the peer literature, not a caricature.

### Why trust an unaudited security library?

Do not trust it, read it. The core is small enough to audit in an afternoon, has zero
runtime dependencies, and never throws for an expected failure: every outcome is a
typed value, so a stray `try/catch` cannot turn a deny into a grant. It fails closed
on every error path (a store outage denies, it never grants), and an adversarial
review of the whole grant/deny surface found no path where it grants when it should
deny. It is not audited, and we say so in the README and SECURITY.md. Treat it as
defense-in-depth with an explicit threat model and reproducible tests, not as a
substitute for an audit.

An independent audit is welcome. If you review security code professionally, open an
issue or use the contact in SECURITY.md; we would rather have this checked than ask
anyone to take our word for it.

### Why a separate library instead of fixing x402?

Because most of what it hardens is x402's intended design, not a bug to patch. x402 is
optimistic on purpose: settlement is slow, and making every request block on it would
ruin the agentic-payment experience. The reference correctly leaves "dedupe concurrent
requests, wait for finality, set cache headers" to the integrator. This is that
integrator-side layer, for merchants who cannot run optimistically.

### I'm on Base, do I even need this?

Depends which part, and we would rather tell you what to skip than pretend it is all
essential. The replay/race and cache-leakage protections apply anywhere you serve paid
content, Base included. The finality (reorg) protection is largely *not* for Base: it
is a single-sequencer L2 where a settled transfer effectively does not reverse, so
holding for confirmations there is belt-and-suspenders, and we ship it off by default.
It earns its keep on higher-reorg chains or when you deliver something irreversible.
And the default in-memory store only protects one process, so on Workers, Vercel, or
Lambda you need the Durable Object store, or replay protection does not hold across
instances.

## Expert questions

### EIP-3009 enforces nonce single-use on-chain. What is the actual off-chain attack surface?

The `authorizationState` mapping makes on-chain replay impossible: a second
`transferWithAuthorization` with the same nonce reverts. The surface is entirely the
off-chain window between the facilitator's `/verify` (a read, no state change, returns
valid for every concurrent caller because the nonce is not consumed yet) and the
settlement landing. In the reference, that window contains resource delivery, and
`verify` takes no lock. So the attack is not "replay the payment on-chain," it is
"extract N deliveries from one authorization during the verify-to-settle window." In
the reference this is not even timing-sensitive: `processHTTPRequest` (verify, deliver)
and `processSettlement` are structurally separate calls, so all N verifies necessarily
precede any settlement. The guard makes nonce reservation an atomic check-and-set at
the server, ahead of delivery, collapsing the window to a single winner.

### `boundResource` only sets the error code. So substitution is not a separate control, is it?

Correct, and we do not claim it is. The single-use reservation is what prevents one
payment being spent at two resources; the second use of a nonce is denied whichever
resource it targets. The resource binding does not change any grant/deny outcome. It
only lets you tell a substitution attempt (`nonce-resource-mismatch`) from an ordinary
duplicate (`nonce-already-reserved`) in your logs, so you can respond differently. We
expose it as a distinct reason because the operational response differs, not because it
is a separate mechanism. The underlying protocol fact: x402 v2 `PaymentRequirements`
has no resource field and EIP-3009 signs money, not the URL, so a payment binds to
`(payTo, amount, asset, network)`. Amount-matching at the facilitator already blocks
cheap-to-expensive substitution, leaving only equal-priced, same-wallet resources
fungible.

### Reorgs on Base are effectively impossible for a settled transfer. Is the finality gate defending a non-threat?

On Base, largely yes, and we say so. It is a single-sequencer OP-stack L2, and a
settled USDC transfer does not reverse absent an L1 reorg, so `finality: "confirm"`
there is belt-and-suspenders. That is why it is off by default (`finality:
"facilitator"`). It earns its keep on chains with real reorg depth, or when your
handler does something irreversible (ships a good, releases a secret) where even a rare
reversal is unacceptable. Calling it a headline mitigation on Base would be
overclaiming; it is an opt-in for a specific risk posture. Note also that a buffered
adapter that settles before flushing bytes closes grant-before-*settle*, but not
grant-before-*finality*: a shallow-confirmation settlement can still reverse after the
body is out.

### You close Attack I-A but not I-B (unauthorized settlement preemption). Why not, and shouldn't a serious hardening library cover it?

Because I-B cannot be fixed at this layer, and pretending otherwise would be dishonest.
In I-B an attacker who observes the `X-PAYMENT` header in transit (a logging proxy, a
TLS terminator, a Byzantine server) submits the signed authorization to the chain first,
for a few cents of gas. The funds still reach the merchant, since EIP-3009 binds the
`to` address, but the attacker's transaction consumes the nonce, so the honest
settlement fails and the payer is charged with nothing delivered. The victim is the
payer, not the merchant. The root cause is that EIP-3009 places no caller restriction on
settlement: any observer can submit a signed authorization. The fix (facilitator-bound
settlement: a Permit2 Witness enforcing `msg.sender == witness.facilitator`, or an
EIP-3009 wrapper contract that checks the caller) is on-chain contract code and
facilitator control, one to two layers below an off-chain, zero-dependency resource-server
library. We cannot deploy a contract or own the settlement call from here. What the guard
does do is a byproduct of failing closed: it settles before granting, so a preempted
payment produces a deny, not a free grant, though it cannot un-charge the payer. The one
control an operator holds is to treat the `X-PAYMENT` header as bearer payment material:
do not log it, terminate TLS at the app, and keep it off untrusted middleware. That is in
[the hardening notes](/x402-server-guard/reference/hardening/); the on-chain fix is not
ours to ship.

### You trust the facilitator for signature and amount verification. Isn't independent verification the harder, more valuable problem?

It may be the higher-value target, but it is a different one, and the boundary is
deliberate. The guard trusts the facilitator's `/verify` result and hardens the
server-side flow around it (reservation, finality, cache). Verifying the signature and
amount is the facilitator's role; reproducing it in the guard would pull cryptographic
primitives into a core that is dependency-free by design, so it stays out. The
concurrency race this library closes exists regardless of who verifies the signature,
so the two concerns are cleanly separable.

### Your Durable Object store has no `maxEntries` cap. Can't a wallet flood you into unbounded objects?

Yes, and it is documented. The in-memory store caps retained entries; per-nonce Durable
Objects cannot share one counter without reintroducing the global bottleneck the design
removes, so there is no equivalent cap. A payer who signs many authorizations with a
far-future `validBefore` can accumulate objects until they expire. The real bound is
rate limiting upstream of the reserve (per payer or per IP); reservation runs after the
facilitator verifies the signature, so only authenticated payers reach it, not anonymous
traffic. Window length is not a reliable bound because the payer controls `validBefore`.

### Canonicalization via `URL.href` overstates RFC 3986 normalization and varies by ICU.

True on both counts, and it does not affect safety. `URL.href` folds scheme and host
case, the default port, and dot-segments, but it does not decode unreserved
percent-encoded octets (`%41` stays `%41`), so it is not full RFC 3986 equivalence, and
its IDN/punycode output can vary with the runtime's ICU. Because the resource key only
selects the deny *reason* and never the grant/deny outcome, a mis-normalization can at
worst mislabel a deny. For a persistent distributed store, pin a stable resource form
rather than rely on `URL.href` across engine upgrades.

### How is this actually atomic across serverless isolates?

The default in-memory store is not: each isolate has its own map, so it protects one
process only. For multi-isolate deploys the store is a pluggable contract: any backend
with a native atomic compare-and-set satisfies it (Redis `SET NX`, a database unique
constraint), while a plain get-then-put store like Workers KV does not, because the
read-to-set gap reopens the race condition. We ship one such backend, a Cloudflare Durable
Object store that routes each nonce to its own object. A Durable Object serves one request at a time and
holds delivery of other events while a storage operation to the same object is in
flight (input gating), so the reserve check-and-set is atomic with no lock. We prove it:
[`test/cloudflare/durable-object.test.ts`](../test/cloudflare/durable-object.test.ts)
fires twenty-five concurrent reservations of one nonce in real workerd, and exactly one
wins.
