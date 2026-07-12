# Coverage map

Each enumerated attack class, the research that describes it, the mechanism the
guard uses, and the test that proves both the attack against a vanilla server and
that the guard blocks it. Every guarded test shares a file with the baseline
reproduction it flips, so one file shows the exploit landing and then blocked.

| Attack class | Research | Mechanism | Reproduction + guarded proof |
| --- | --- | --- | --- |
| Duplicate-settlement race | [arXiv:2605.11781](https://arxiv.org/abs/2605.11781) | Atomic nonce reservation before grant | [`test/attacks/duplicate-settlement-race.test.ts`](../test/attacks/duplicate-settlement-race.test.ts) (baseline grants 5 for 1 payment; guarded grants 1) |
| Payment replay | [arXiv:2605.11781](https://arxiv.org/abs/2605.11781) | Same reservation, single-use nonce | [`test/attacks/duplicate-settlement-race.test.ts`](../test/attacks/duplicate-settlement-race.test.ts) (replay denied) + [`src/guard.test.ts`](../src/guard.test.ts) |
| Cross-resource substitution | [arXiv:2605.11781](https://arxiv.org/abs/2605.11781) | Bind nonce to the served resource; `nonce-resource-mismatch` | [`test/attacks/cross-resource-substitution.test.ts`](../test/attacks/cross-resource-substitution.test.ts) (guarded suite) |
| Grant-before-finality | [arXiv:2605.30998](https://arxiv.org/abs/2605.30998) | Hold to k confirmations; fenced `release` on reorg | [`test/attacks/grant-before-finality.test.ts`](../test/attacks/grant-before-finality.test.ts) (guarded suite) |
| Cache leakage of paid content | [arXiv:2605.30998](https://arxiv.org/abs/2605.30998) | `no-store, private` + `Vary` on paid responses | [`test/attacks/cache-leakage.test.ts`](../test/attacks/cache-leakage.test.ts) (guarded suite) |

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

The guard mitigates these five listed line items (four distinct classes; replay
and the race share one mechanism). It is not audited and is not a security
guarantee. It cannot make an insecure endpoint safe on its own, and anything not
listed here is out of scope. See [`SECURITY.md`](../SECURITY.md).
