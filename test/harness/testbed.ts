/**
 * One-call factory that wires the three pieces of the testbed together: a
 * `FakeChain` (single-use nonces), a `FakeFacilitator` (x402's real
 * `FacilitatorClient`, faithfully flawed), and a naive `BaselineResourceServer`.
 *
 * Every test needs the same wiring, so it lives here once. Tests reach for the
 * handle they care about (`chain` for settle counts, `server` for grants) and
 * ignore the rest.
 */
import type { PaymentRequirements } from "@x402/core/types";
import { BaselineResourceServer } from "./baseline-server.js";
import { FakeChain } from "./fake-chain.js";
import { FakeFacilitator } from "./fake-facilitator.js";

export interface TestbedOptions {
  /** Block-inclusion latency for the fake chain, in ms. Default 0. */
  settlementLatencyMs?: number;
  /** What the server hands back on a grant. Default returns a fixed string. */
  deliver?: (requirements: PaymentRequirements) => string;
  /** The resource this endpoint serves, for resource-binding scenarios. */
  resourceUrl?: string;
}

export interface Testbed {
  chain: FakeChain;
  facilitator: FakeFacilitator;
  server: BaselineResourceServer<string>;
}

/** Wire a fresh chain, facilitator, and baseline server for one test. */
export function createTestbed(options: TestbedOptions = {}): Testbed {
  const chain = new FakeChain(options.settlementLatencyMs);
  const facilitator = new FakeFacilitator(chain);
  const deliver = options.deliver ?? (() => "the-resource");
  const server = new BaselineResourceServer(facilitator, deliver, options.resourceUrl);
  return { chain, facilitator, server };
}
