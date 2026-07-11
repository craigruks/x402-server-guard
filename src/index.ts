/**
 * @craigruks/x402-server-guard
 *
 * Server-side hardening middleware for x402 payment endpoints.
 *
 * SECURITY DISCLAIMER: This software is provided "AS IS", without warranty of
 * any kind. It is NOT audited and is NOT a security guarantee. It mitigates
 * specific, enumerated attack classes only. It cannot make an insecure payment
 * endpoint safe on its own. See SECURITY.md for scope and reporting.
 *
 * Status: v0.1 scaffold. No mitigations are implemented yet. This release sets
 * up the toolchain, packaging, and trust surface only.
 */

/** Current package version (semver). */
export const VERSION: string = "0.1.0";

export { err, ok, type Result, tryCatch, tryCatchAsync } from "./result.js";
