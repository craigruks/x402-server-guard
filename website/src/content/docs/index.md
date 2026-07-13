---
title: "x402-server-guard: how it works, in plain terms"
description: Server-side hardening for x402 payment endpoints.
---

This is the teaching companion to the library. It explains, without assuming you
know crypto, what each attack is, how it lets someone cheat a paid endpoint, and
how the guard stops it. Every page shows the vulnerable code first and the fixed
code second.

The authoritative, code-exact facts live in the repository:
[`docs/coverage-map.md`](https://github.com/craigruks/x402-server-guard/blob/main/docs/coverage-map.md)
maps each attack to the test that proves it, and
[`docs/hardening.md`](https://github.com/craigruks/x402-server-guard/blob/main/docs/hardening.md)
explains the mechanisms in depth. These wiki pages are the friendly narrative; when
in doubt, the repo is the source of truth.

## Start here

If you are new to x402, read
[1. Understanding x402](/x402-server-guard/getting-started/understanding-x402/) first. It is a short, attack-relevant
primer (the `402` flow, the signed payment, the `nonce`, and the `verify` vs `settle`
gap) and it links out to the official x402 docs. Everything below assumes it.

## The attacks and the fixes

| # | Attack | In one line | Fix |
| --- | --- | --- | --- |
| 2 | [Duplicate-Settlement Race and Replay](/x402-server-guard/mitigations/race-and-replay/) | Fire the same payment many times at once, get many resources for one payment | Reserve the nonce before delivering |
| 3 | [Cross-Resource Substitution](/x402-server-guard/mitigations/substitution/) | Spend a payment meant for A at resource B | Bind the nonce to the served resource |
| 4 | [Grant-Before-Finality](/x402-server-guard/mitigations/finality/) | Get the resource, then have the payment reversed by a chain reorg | Hold to k confirmations, release on failure |
| 5 | [Cache Leakage](/x402-server-guard/mitigations/cache-leakage/) | A shared cache serves the paid response to unpaid clients | `no-store, private` on paid responses |

## The research

The attacks come from two papers. Each page cites the specific attack or invariant
it addresses.

- Zelin Li, Qin Wang, Zhipeng Wang. "Five Attacks on x402 Agentic Payment
  Protocol." https://arxiv.org/abs/2605.11781
- Shengchen Ling et al. "Free-Riding the Agentic Web: A Systematic Security Analysis
  of x402 Payments." https://arxiv.org/abs/2605.30998

## One honest disclaimer

This library is not audited and is not a security guarantee. It mitigates these
specific attack classes. It cannot make an insecure endpoint safe on its own.
