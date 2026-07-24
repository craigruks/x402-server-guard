# Coverage map

Each enumerated attack class, the research that describes it, the mechanism the
guard uses, and the test that proves both the attack against a vanilla server and
that the guard blocks it. Every guarded test shares a file with the baseline
reproduction it flips, so one file shows the exploit landing and then blocked.

| Attack class | Research | Mechanism | Reproduction + guarded proof |
| --- | --- | --- | --- |
| Duplicate-settlement race | [Five Attacks], Attack II; [Free-Riding], I4 | Atomic nonce reservation before grant | [`test/attacks/duplicate-settlement-race.test.ts`](../test/attacks/duplicate-settlement-race.test.ts) (baseline grants 5 for 1 payment; guarded grants 1) |
| Payment replay | [Five Attacks], Attack II | Same reservation, single-use nonce keyed on a canonical form | [`test/attacks/duplicate-settlement-race.test.ts`](../test/attacks/duplicate-settlement-race.test.ts) (replay denied) + [`src/guard.test.ts`](../src/guard.test.ts) |
| Cross-resource substitution | [Free-Riding], Context Binding (I3); [Five Attacks], binding | The single-use reservation already denies the reuse; binding the nonce to the served resource only flags it distinctly (`nonce-resource-mismatch`) | [`test/attacks/cross-resource-substitution.test.ts`](../test/attacks/cross-resource-substitution.test.ts) (guarded suite) |
| Grant-before-finality | [Five Attacks], Attack I-A | Hold to k confirmations; fenced `release` on reorg | [`test/attacks/grant-before-finality.test.ts`](../test/attacks/grant-before-finality.test.ts) (guarded suite) |
| Cache leakage of paid content | [Five Attacks], Attack III | `no-store, private` + `Vary` on paid responses | [`test/attacks/cache-leakage.test.ts`](../test/attacks/cache-leakage.test.ts) (guarded suite) |

[Five Attacks]: https://arxiv.org/abs/2605.11781
[Free-Riding]: https://arxiv.org/abs/2605.30998

## On-chain reproductions (forked mainnet)

The baseline race, substitution, and finality attacks also land against real
forked Base Sepolia USDC in [`e2e/`](../e2e/README.md) (Anvil fork via prool +
viem test actions, no faucet or key required), and one hosted-facilitator run
settles a real substitution transfer against a funded testnet key. These are
baseline reproductions only: they show the attacks landing on-chain. The guarded
on-chain variants (each attack re-run against the hardened server) are not built
yet; the CI-gated guarded proofs are the unit-level ones in the table above.

## Rationale and sources

The mechanism behind each mitigation, why it is shaped that way, and the
cross-references to how established off-chain-signature systems (Uniswap permit2,
CoW Protocol, MetaMask `eth-sig-util`, Hyperliquid) handle the same problems are
in [`docs/hardening.md`](./hardening.md). The surveyed state of the reference
`coinbase/x402` server (which of these holes it leaves open) is documented there
as the reason this library exists.

## Scope boundary

The guard mitigates these five listed line items, enumerated as four attack classes
by the research, through three mechanisms: a single-use atomic reservation (the race,
replay, and cross-resource substitution all reduce to it), holding to finality, and
cache directives. It is not audited and is not a security guarantee. It cannot make an insecure endpoint safe on its own, and anything not
listed here is out of scope. See [`SECURITY.md`](../SECURITY.md).

## Confirmation

Shengchen Ling, an author of [Free-Riding], reviewed how this library maps to the
paper's flaw classes and invariants and confirmed it aligns with the paper's
intended interpretation. This is not an audit or endorsement of the
implementation.

## References

- **Five Attacks**: Zelin Li, Qin Wang, Zhipeng Wang. "Five Attacks on x402
  Agentic Payment Protocol." arXiv:2605.11781. https://arxiv.org/abs/2605.11781
  Attack I-A (revert-grant under optimistic execution) is grant-before-finality;
  Attack II (replay / idempotency across the HTTP-chain boundary) is the race and
  replay; Attack III (HTTP / proxy-level handling) is the cache leak; the binding
  weakness is cross-resource substitution. Attacks I-B (unauthorized settlement
  preemption) and IV (server-selection / Sybil) are out of this library's scope:
  I-B is a settlement-path and facilitator concern the resource server cannot
  enforce, and IV occurs at endpoint discovery before the payment flow begins.
- **Free-Riding**: Shengchen Ling, Yihang Huang, Yuefeng Du, Yuan Chen, Yajin Zhou,
  Lei Wu, Cong Wang. "Free-Riding the Agentic Web: A Systematic Security Analysis of
  x402 Payments." arXiv:2605.30998. https://arxiv.org/abs/2605.30998
  Cross-resource substitution violates its Context Binding invariant (I3);
  probabilistic service duplication violates Authorization Uniqueness (I4). Its
  allowance-overdraft and denial-of-settlement flaws are out of this library's scope.
