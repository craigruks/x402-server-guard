# e2e: x402 attacks against real infrastructure

Reproductions of the modeled attacks (`../test/attacks`) against real x402
infrastructure, to prove the threat model is faithful and not a strawman. Two tiers:

- **Fork harness** (`src/fork`): the attacks against a local Anvil fork of Base
  Sepolia, with the real USDC contract and real EIP-3009 logic. Self-verifying
  vitest tests. No faucet, no key.
- **Collusion-killer** (`src/hosted`): one run of cross-resource substitution
  against Coinbase's hosted facilitator, which we do not operate, producing a
  public settlement transaction. Needs a funded testnet key.

Isolated: its own package, its own dependencies, out of the package's CI gate, and
nothing here ships in the published npm package.

## Setup

Foundry (for `anvil`) and Node are pinned with mise; dependencies are npm.

```sh
cd e2e
mise install     # anvil (via foundry) + node
npm install
```

## Run the fork harness (no secrets)

```sh
npm run test:fork
```

Boots an Anvil fork of Base Sepolia with prool (pinned block), funds the buyer's
test USDC with viem-deal, and runs all four attacks as vitest tests:

- smoke: a payment verifies, settles, and moves forked USDC by the exact price
- settlement race: N grants, one settlement
- cross-resource substitution: granted at B, denied at A
- grant-before-finality: granted at zero confirmations, then reorged away

Needs no faucet and no key: the fork funds the buyer by overriding a storage slot.
Detail in `src/fork/README.md`.

## Run the collusion-killer (needs a funded key)

This hits the public network against a facilitator we do not control, so it needs a
real (tiny) payment.

1. **Fund a Base Sepolia key with test USDC.**
   - Go to https://faucet.circle.com
   - In the network dropdown, select **Base Sepolia**. Not Ethereum Sepolia, which
     is the default and a common mistake (the token addresses differ per chain).
   - Paste your wallet address, complete the captcha, request. No gas ETH is needed:
     the buyer is gasless (EIP-3009), and the facilitator pays gas on settle.
2. **Put the key in `.env`.**
   ```sh
   cp .env.example .env
   # set BUYER_PRIVATE_KEY to the funded key; FACILITATOR_URL defaults to the hosted one
   ```
3. **Run it.**
   ```sh
   npm run test:hosted
   ```

It prints a BaseScan transaction. `.env` is gitignored, so the key is never
committed. The recorded evidence from our run is in `src/hosted/README.md`.

## What ships

Nothing. `e2e/` is excluded from the published package (`npm pack` contains zero
e2e files), and the harness dependencies (prool, viem-deal, viem, Foundry) are
dev-only. The package stays zero runtime dependencies.
