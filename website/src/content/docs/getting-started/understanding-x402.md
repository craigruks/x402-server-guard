---
title: Understanding x402
description: Enough of the protocol to follow the attacks.
sidebar:
  label: Understanding x402
---

This page is the minimum you need to understand every attack in these guides. It is a
short, attack-relevant version. For the real thing, read the official docs, which
are excellent:

- x402 documentation: https://docs.x402.org
- Quickstart for sellers (the server side, which this library protects):
  https://docs.x402.org/getting-started/quickstart-for-sellers
- Quickstart for buyers (the client side):
  https://docs.x402.org/getting-started/quickstart-for-buyers
- The protocol and reference SDKs: https://github.com/coinbase/x402

## What x402 is

x402 is a way to charge money for an HTTP request. `402 Payment Required` is a status
code that has sat unused in the HTTP spec for years. x402 puts it to work: a server
answers `402`, the client pays, and the client retries and gets the resource. The
payment is settled on a blockchain in stablecoin (USDC), so it works for machines and
agents, not just people with credit cards.

## The cast

- **Payer / client**: wants the resource, has a crypto wallet.
- **Resource server / merchant**: you, the one selling the endpoint. **This library
  protects you.**
- **Facilitator**: a payments processor that does the blockchain work so you do not
  have to run a node. It exposes two operations that matter enormously (below).
- **The blockchain** (usually Base, an Ethereum layer-2): the ledger where the money
  actually moves.

## The request flow

```
1. Client:  GET /api
2. Server:  402 Payment Required   + "pay 1 USDC to 0xMerchant on Base"
3. Client:  GET /api   with header  X-PAYMENT: <signed payment>
4. Server:  asks the facilitator to verify, then settle the payment
5. Server:  200 OK  + the resource
```

## The one primitive: a signed authorization

The client does not send you dollars. It sends a **signed authorization**: a message
saying "I authorize moving 1 USDC from me to 0xMerchant," signed by the payer's
wallet. The standard is EIP-3009 `transferWithAuthorization`
(https://eips.ethereum.org/EIPS/eip-3009). The signed message contains exactly:

```
{ from, to, value, validAfter, validBefore, nonce }
```

- `from`, `to`, `value`: who pays whom, how much.
- `validAfter` / `validBefore`: the time window the payment is good for. `validBefore`
  is the expiry (unix seconds).
- `nonce`: a **random 32-byte number the client picks**, unique to this one payment.
  It is the anti-double-use token.

The signature proves the payer really authorized it: only their private key could
produce it. Anyone holding the signed authorization can submit it to the USDC
contract to move the money, which is why the merchant pays no gas: the facilitator
submits it.

## verify vs settle: the gap that matters

The facilitator exposes two operations, and the difference between them is the root of
the first attack:

- **`verify()`**: a cheap **read**. Is the signature valid, the amount right, and the
  nonce not yet used? No money moves. Fast.
- **`settle()`**: the **write**. Actually submit the transaction on-chain to move the
  USDC. Slow (seconds), costs gas, and this is what marks the nonce as **used** on the
  chain.

The token contract guarantees a nonce is used at most once: the **first** `settle()`
for a nonce wins; any later `settle()` of the same nonce fails. Hold onto that.

## The three facts every attack exploits

Keep these in mind and the attacks almost explain themselves:

1. **There is a time gap between `verify` (read) and `settle` (write).** Verify sees
   the nonce as free until settle finishes recording it. That gap is a race window.
   (Attack: [Race and replay](/x402-server-guard/mitigations/race-and-replay/).)
2. **The authorization does not sign the resource.** It signs who-pays-whom-how-much,
   not which URL. So a payment for one resource looks identical to a payment for
   another at the same price. (Attack:
   [Cross-resource substitution](/x402-server-guard/mitigations/substitution/).)
3. **"Settled" is not "final".** A settled payment can still be reversed by a brief
   blockchain reorganization until enough later blocks bury it. (Attack:
   [Grant-before-finality](/x402-server-guard/mitigations/finality/).)

Plus one that is not about the payment at all, but about HTTP: a shared cache in front
of your server can store a paid response and serve it to unpaid clients. (Attack:
[Cache leakage](/x402-server-guard/mitigations/cache-leakage/).)

## Next

Start with [Race and replay](/x402-server-guard/mitigations/race-and-replay/).
