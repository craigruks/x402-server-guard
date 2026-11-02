/**
 * The real `@x402/core` reference resource server, wired for the reference
 * suites: the repo `FakeFacilitator` (x402's real `FacilitatorClient`) and a
 * minimal `exact` scheme (x402's real `SchemeNetworkServer` interface, no grant
 * logic). Nothing on the grant path is reimplemented.
 */
import type { HTTPAdapter, HTTPProcessResult, RoutesConfig } from "@x402/core/server";
import { x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type {
  AssetAmount,
  Network,
  PaymentRequirements,
  SchemeNetworkServer,
} from "@x402/core/types";
import type { FakeChain } from "./fake-chain.js";
import { FakeFacilitator } from "./fake-facilitator.js";
import type { makePayment } from "./payment.js";

export const REFERENCE_NETWORK: Network = "eip155:84532";
export const REFERENCE_PATH = "/paid";
export const REFERENCE_URL = "https://api.example.test/paid";

type PaymentFixture = ReturnType<typeof makePayment>;

/** Upstream's payment flows. `authorization` is the default: verify, handler, settle. */
export type ReferenceFlow = "authorization" | "upfront";

/**
 * The scheme mirrors the fixture's amount/asset so the requirement the server
 * builds deep-equals the payment's `accepted` block and `findMatchingRequirements`
 * matches. Its flow table copies `ExactEvmScheme` in `@x402/evm` 2.29.0
 * (`exact/server/scheme.ts`): EIP-3009 supports `authorization` and `upfront`,
 * and defaults to `authorization`.
 */
function exactScheme(fixture: PaymentFixture): SchemeNetworkServer {
  return {
    scheme: "exact",
    defaultAssetTransferMethod: "eip3009",
    paymentFlows: {
      eip3009: { supported: ["authorization", "upfront"], default: "authorization" },
    },
    async parsePrice(): Promise<AssetAmount> {
      return { asset: fixture.requirements.asset, amount: fixture.requirements.amount };
    },
    async enhancePaymentRequirements(base: PaymentRequirements): Promise<PaymentRequirements> {
      return base;
    },
  };
}

/**
 * Build the reference server for one payment fixture. A non-default `flow` is
 * requested through the route's `extra`, as a merchant would, and the fixture's
 * `accepted` block is updated to the requirement the server will advertise.
 */
export function buildReferenceServer(
  chain: FakeChain,
  fixture: PaymentFixture,
  flow: ReferenceFlow = "authorization",
): { core: x402ResourceServer; http: x402HTTPResourceServer } {
  const extra = flow === "authorization" ? {} : { paymentFlow: flow };
  fixture.requirements.extra = extra;
  fixture.payload.accepted = fixture.requirements;

  const core = new x402ResourceServer(new FakeFacilitator(chain));
  core.register(REFERENCE_NETWORK, exactScheme(fixture));
  const routes: RoutesConfig = {
    [`GET ${REFERENCE_PATH}`]: {
      resource: REFERENCE_URL,
      accepts: {
        scheme: "exact",
        network: REFERENCE_NETWORK,
        price: fixture.requirements.amount,
        payTo: fixture.requirements.payTo,
        maxTimeoutSeconds: fixture.requirements.maxTimeoutSeconds,
        extra,
      },
    },
  };
  return { core, http: new x402HTTPResourceServer(core, routes) };
}

/** The request context for one paid GET carrying the fixture's payment header. */
export function referenceRequest(fixture: PaymentFixture) {
  const header = Buffer.from(JSON.stringify(fixture.payload)).toString("base64");
  const adapter: HTTPAdapter = {
    getHeader: (name) => (name.toLowerCase() === "payment-signature" ? header : undefined),
    getMethod: () => "GET",
    getPath: () => REFERENCE_PATH,
    getUrl: () => REFERENCE_URL,
    getAcceptHeader: () => "application/json",
    getUserAgent: () => "vitest-attacker/1.0",
  };
  return { adapter, path: REFERENCE_PATH, method: "GET" };
}

export const isVerified = (
  r: HTTPProcessResult,
): r is Extract<HTTPProcessResult, { type: "payment-verified" }> => r.type === "payment-verified";
