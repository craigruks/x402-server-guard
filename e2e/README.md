# Live spike: x402 attacks on Base Sepolia

This directory reproduces two of the modeled attacks against **real** x402
infrastructure on Base Sepolia, to confirm the in-code threat model
(`../test/attacks`) is faithful to the live protocol and not a strawman.

It is opt-in and isolated: its own `package.json`, its own dependencies, its own
env. It is **not** part of the package's CI gate, and nothing here ships in the
published npm package. Cloning and running the unit tests needs no secrets; only
this spike does.

## What it proves, and the honest framing

The facilitator is **unmodified** in every run. The vulnerability lives entirely
in the naive resource server (`src/naive-server.ts`), which mirrors the pattern
the research shows a straightforward integrator writes: it grants the resource
the moment `/verify` passes, before `/settle` confirms, and it never binds a
payment to the resource it serves. We point that naive server at an honest
facilitator and the attacks land.

Two attacks reproduce live:

- **Cross-resource substitution.** A payment made for resource A is granted at the
  endpoint serving resource B. No timing involved.
- **Settlement race.** Concurrent requests carrying one payment are all granted
  while only one settles on-chain. The real ~2s block-inclusion window is the race
  window; nothing is faked.

Two attacks stay in-model and are **not** reproduced here, honestly:

- **Grant-before-finality** cannot be reproduced on Base Sepolia: you cannot force
  a reorg on its single sequencer. It needs a chain whose ordering you control
  (Anvil, or a Tenderly virtual testnet). Modeled only, for now.
- **Cache leakage** is an HTTP-caching flaw, not an on-chain one; it is covered by
  the in-code reproduction.

## Two facilitators, two levels of proof

- **Self-hosted (primary).** Run the official x402 reference facilitator, pinned
  and unmodified, locally (see `scripts/run-facilitator.md`). This is the rigorous
  rig: full-stack transparency, instrumentable verify/settle timing, isolated and
  reproducible, and it does not hammer a shared public service. The "did you modify
  the facilitator?" question is answered by the commit pin, which you can diff.
- **Hosted (corroboration).** For substitution only (timing-insensitive, low
  volume), also run against `https://x402.org/facilitator`, Coinbase's own live
  testnet service, which we demonstrably do not control. Same attack, their
  facilitator, on-chain proof by tx hash. This erases any lingering doubt cheaply.

## Setup

1. `cp .env.example .env` and set `BUYER_PRIVATE_KEY` to a testnet wallet.
2. Fund it with test USDC: https://faucet.circle.com (Base Sepolia). No gas ETH
   needed for the buyer (EIP-3009 is gasless).
3. `npm install` (in this directory).

## Run

In one terminal, start the naive server (it points at the facilitator in your `.env`):

```sh
npm run server
```

In another, run an attack against it:

```sh
npm run attack:substitution   # payment for resource A is granted at resource B
npm run attack:race           # one payment, N concurrent grants, one settlement
```

Each attack prints the settled transaction hash; verify it on
https://sepolia.basescan.org to confirm the payment actually settled on-chain.

By default both run against the keyless hosted facilitator. To use the self-hosted
rig instead, see `scripts/run-facilitator.md` and set `FACILITATOR_URL` in `.env`.

## Stack

x402 **v2** throughout (`@x402/core`, `@x402/fetch`, `@x402/evm` at 2.18.0), matching
the package and the in-code model. The hosted facilitator speaks v2 on Base Sepolia,
so the whole loop is keyless. The client signing is the real `@x402/fetch` path
(EIP-3009 `transferWithAuthorization`); only the resource server is hand-rolled, so
the naive behavior is explicit and auditable in `src/naive-server.ts`.

## Verified vs not

Building this scaffold, we verify structure and typechecking. The live on-chain
runs require a funded testnet key, which is yours to provide; those are the proof,
and their output (grant counts, tx hashes) is what you check against BaseScan.
