# Self-hosting the facilitator (optional, the rigorous rig)

The spike defaults to the keyless hosted facilitator (`https://x402.org/facilitator`),
which speaks x402 v2 on Base Sepolia and needs no credentials. That is the simplest
path and is maximally credible: it is Coinbase's own service, which we demonstrably
do not control.

Self-host only if you want to instrument the verify/settle window yourself or run
fully in isolation. The facilitator is still the **official, unmodified** reference
implementation; pin it to a commit so anyone can diff it against upstream.

## Steps

```sh
git clone https://github.com/coinbase/x402
cd x402
git checkout <PINNED_COMMIT>        # record the exact commit you ran
cd examples/typescript
pnpm install && pnpm build
cd facilitator/basic
cp ../.env-local .env                # set EVM_PRIVATE_KEY (funded with Base Sepolia ETH for gas)
pnpm dev                             # -> Facilitator listening on http://localhost:4022
```

Then point the spike at it:

```sh
# in e2e/.env
FACILITATOR_URL=http://localhost:4022
```

## Friction to know about

- The `basic` example currently hard-requires **both** `EVM_PRIVATE_KEY` and
  `SVM_PRIVATE_KEY` and exits if the Solana key is missing, even for an EVM-only run.
  Supply a throwaway base58 Solana key, or delete the SVM registration block.
- Its EVM wallet pays gas on settle, so fund it with Base Sepolia ETH (a faucet is
  linked in the top-level README).
- It listens on port 4022 and exposes `POST /verify`, `POST /settle`, `GET /supported`.

If any of that is more than you want, stay on the hosted facilitator. The attack
lands identically either way; the vulnerability is in the naive server, not the
facilitator.
