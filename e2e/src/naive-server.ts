/**
 * A deliberately naive x402 resource server, hand-rolled over @x402/core.
 *
 * It is the same baseline the in-code reproductions model, made real: it verifies
 * the payment, DELIVERS the resource, and only then settles. verify() takes no
 * lock on the nonce, and the server never binds a payment to the resource it
 * serves. The facilitator it points at is unmodified and honest; every flaw here
 * is in this file.
 *
 * It serves any path as a distinct resource at the same price, tracks grant and
 * settlement outcomes, and exposes them at GET /__stats so the attack drivers can
 * assert "granted N times, settled once".
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { HTTPFacilitatorClient, decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { config } from "./config.js";

const PORT = Number(process.env.SERVER_PORT ?? "4021");
const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

type SettleOutcome = { ok: boolean; transaction?: string; reason?: string };
const stats = { granted: 0, settled: [] as SettleOutcome[] };

/** Payment requirements for a resource. Every resource is the same price, on purpose. */
function requirementsFor(): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: config.priceAtomic,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    // Base Sepolia USDC EIP-712 domain, which the client needs to sign the authorization.
    extra: { name: "USDC", version: "2" },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

function challenge(resourceUrl: string, error?: string): PaymentRequired {
  return { x402Version: 2, resource: { url: resourceUrl }, accepts: [requirementsFor()], ...(error ? { error } : {}) };
}

async function handleResource(resourceUrl: string, paymentHeader: string, res: ServerResponse): Promise<void> {
  const payment: PaymentPayload = decodePaymentSignatureHeader(paymentHeader);
  const requirements = requirementsFor();

  const verification = await facilitator.verify(payment, requirements);
  if (!verification.isValid) {
    send(res, 402, challenge(resourceUrl, verification.invalidReason ?? "payment invalid"));
    return;
  }

  // NAIVE: deliver first, settle second. No nonce lock, no resource binding. A
  // concurrent or substituted payment that clears verify before this settles is
  // also granted.
  stats.granted += 1;
  send(res, 200, { resource: resourceUrl, data: "the paid content" });

  const settlement = await facilitator.settle(payment, requirements);
  stats.settled.push(
    settlement.success
      ? { ok: true, transaction: settlement.transaction }
      : { ok: false, reason: settlement.errorReason ?? "settle failed" },
  );
}

function requestUrl(req: IncomingMessage): string {
  return `http://localhost:${PORT}${req.url ?? "/"}`;
}

const server = createServer((req, res) => {
  const url = requestUrl(req);
  if (req.url === "/__stats") {
    send(res, 200, stats);
    return;
  }
  const paymentHeader = req.headers["x-payment"];
  if (typeof paymentHeader !== "string" || paymentHeader === "") {
    send(res, 402, challenge(url));
    return;
  }
  handleResource(url, paymentHeader, res).catch((error: unknown) => {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.listen(PORT, () => {
  console.log(`naive x402 server on http://localhost:${PORT} -> facilitator ${config.facilitatorUrl}`);
});
