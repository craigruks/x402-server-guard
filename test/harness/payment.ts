/**
 * Fixtures for constructing valid x402 payments and requirements, and for
 * safely reading the exact-EVM body back out of an opaque `PaymentPayload`.
 */
import { randomBytes } from "node:crypto";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { ExactEvmAuthorization, ExactEvmPayload } from "./types.js";

/** A fresh 32-byte random nonce, `0x`-prefixed — as EIP-3009 uses. */
export function newNonce(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

const DEFAULTS = {
  network: "eip155:84532" as const, // Base Sepolia (CAIP-2)
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // test USDC
  amount: "1000", // atomic units (decimal string)
  payTo: "0x000000000000000000000000000000000000dEaD",
  from: "0x00000000000000000000000000000000000000A1",
};

export interface PaymentOptions {
  nonce?: string;
  amount?: string;
  asset?: string;
  network?: `${string}:${string}`;
  payTo?: string;
  from?: string;
  resourceUrl?: string;
}

/** Build a matched `{ payload, requirements }` pair for one payable request. */
export function makePayment(options: PaymentOptions = {}): {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
} {
  const amount = options.amount ?? DEFAULTS.amount;
  const asset = options.asset ?? DEFAULTS.asset;
  const network = options.network ?? DEFAULTS.network;
  const payTo = options.payTo ?? DEFAULTS.payTo;
  const from = options.from ?? DEFAULTS.from;

  const authorization: ExactEvmAuthorization = {
    from,
    to: payTo,
    value: amount,
    validAfter: "0",
    validBefore: "99999999999",
    nonce: options.nonce ?? newNonce(),
  };
  const evmPayload: ExactEvmPayload = {
    signature: `0xsig-${authorization.nonce.slice(2, 18)}`,
    authorization,
  };

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds: 60,
    extra: {},
  };
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: evmPayload as unknown as Record<string, unknown>,
    ...(options.resourceUrl ? { resource: { url: options.resourceUrl } } : {}),
  };
  return { payload, requirements };
}

/**
 * Narrow an opaque `PaymentPayload.payload` to the exact-EVM shape at the
 * boundary. Throws on anything malformed rather than propagating `unknown`.
 */
export function readExactEvmPayload(payload: PaymentPayload): ExactEvmPayload {
  const body = payload.payload;
  const auth = (body as { authorization?: unknown }).authorization;
  const sig = (body as { signature?: unknown }).signature;
  if (typeof sig !== "string" || auth === null || typeof auth !== "object") {
    throw new Error("payload is not a well-formed exact-EVM payment");
  }
  const nonce = (auth as { nonce?: unknown }).nonce;
  const from = (auth as { from?: unknown }).from;
  const value = (auth as { value?: unknown }).value;
  if (typeof nonce !== "string" || typeof from !== "string" || typeof value !== "string") {
    throw new Error("exact-EVM authorization is missing required fields");
  }
  return body as unknown as ExactEvmPayload;
}
