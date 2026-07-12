# Fork harness: x402 attacks on a local Base Sepolia fork

Reproduces the attacks against a local Anvil **fork** of Base Sepolia: the real,
unmodified USDC (FiatToken) bytecode and real EIP-3009 logic, with the
facilitator's verify/settle being the unmodified `@x402/evm` scheme (a pinned
dependency, only its RPC endpoint is local). Funding and block production are
controlled locally, which is what lets it run with no faucet and no key, and what
makes the reorg (finality) attack demonstrable at all.

Why a fork and not just the public testnet: a reproducible fork PoC is the
standard way exploits are demonstrated in audits and bounties ([Immunefi](https://github.com/immunefi-team/forge-poc-templates), [Trail of Bits](https://blog.trailofbits.com/2025/02/12/the-call-for-invariant-driven-development/), [OpenZeppelin](https://www.openzeppelin.com/news/fei-protocol-audit), [Code4rena](https://docs.code4rena.com/competitions/submission-guidelines), [Sherlock](https://docs.sherlock.xyz/audits/judging/guidelines)). It proves a property, not a one-off
event, and anyone can rerun it deterministically. The one thing a fork cannot
provide, a public tx hash from a facilitator we do not operate, is covered
separately by a single hosted-facilitator substitution run.

## Stack

All TypeScript, no shell:

- **prool** boots the Anvil fork from the vitest global setup, pinned to a block.
- **viem test client** (`createTestClient({ mode: "anvil" })`) drives state:
  `snapshot` / `revert` is the reorg, and reads check on-chain balances.
- **viem-deal** funds the buyer's test USDC by overriding its balance slot, so
  there is no faucet and no minter impersonation.
- **vitest** runs the attacks as tests with assertions, so each is self-verifying.

## Run

Foundry is pinned in `e2e/mise.toml`; `mise install` provides `anvil`. Then, from
`e2e/` with mise active (so `anvil` is on PATH):

```sh
npm run test:fork
```

That forks Base Sepolia, funds the buyer, and runs all four attacks. Override the
fork RPC with `BASE_SEPOLIA_RPC`, the pinned block with `FORK_BLOCK`, or the anvil
binary with `ANVIL_BINARY`.

## Attacks

- `smoke.test.ts`: a real payment verifies, settles, and moves forked USDC by the
  exact price (rig proof).
- `attacks/race.test.ts`: N concurrent grants, one settlement. Confirms the real
  `verify` takes no nonce lock.
- `attacks/substitution.test.ts`: a payment for resource A is granted and settled
  at resource B; the same payment is then denied at A.
- `attacks/finality.test.ts`: granted at zero confirmations, then the settling
  transaction is reorged out (`snapshot` / `revert`).

Cache leakage is an HTTP-layer flaw with no on-chain component; it stays the
in-code reproduction (`test/attacks/cache-leakage.test.ts`).

## Still to come with the guard

- The control case: each attack re-run against the hardened server on the same
  rig, proving the harness is not wired to always succeed.
- Bytecode attestation (fork USDC equals real Base Sepolia) and a
  diff-against-upstream of `@x402/evm`.
