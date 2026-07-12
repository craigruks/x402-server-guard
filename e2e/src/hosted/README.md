# Collusion-killer: substitution against a facilitator we do not operate

The fork PoCs run against a facilitator we control, so a skeptic can still say we
rigged it. This one run closes that: the same cross-resource substitution against
Coinbase's own `x402.org/facilitator` on real Base Sepolia, with a public,
verifiable settlement transaction. Same attack, a facilitator we demonstrably do
not control.

## Evidence

A payment signed for resource A was verified, granted, and settled at endpoint B by
`https://x402.org/facilitator`:

- tx: `0x2da8fbd93e82b6ab49923d3189a0be14cae99645db7b1b3e0955aa67f18a6c7c`
- https://sepolia.basescan.org/tx/0x2da8fbd93e82b6ab49923d3189a0be14cae99645db7b1b3e0955aa67f18a6c7c
- Status success, on the real Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`):
  an EIP-3009 `transferWithAuthorization` that consumed the payment nonce
  (`AuthorizationUsed` + `Transfer` logs).

## Reproduce

Fund a Base Sepolia testnet key with test USDC (https://faucet.circle.com, select
**Base Sepolia**), put it in `e2e/.env` as `BUYER_PRIVATE_KEY`, then:

```sh
npx tsx src/hosted/substitution.ts
```

It prints the settlement tx. Opt-in: a real key, a real (tiny) payment, the public
network. Not part of the vitest suite. The key stays in `.env`, never committed.
