/**
 * Canonical keys for the nonce and the resource.
 *
 * The guard keys replay on the nonce and substitution on the resource, both as
 * plain strings used directly as map keys. If the same nonce (or resource) reaches
 * the guard in two encodings, the two forms become two keys for one payment, which
 * reopens the collision the nonce key exists to prevent: the string-encoding cousin
 * of signature malleability (which we already avoid by keying on the nonce, not the
 * signature bytes). `createGuard` folds these encodings by default; a caller with a
 * case- or prefix-sensitive scope can override or opt out (see GuardOptions).
 */

import { tryCatch } from "./result.js";

/**
 * Canonicalize a payment nonce: lowercase it and drop a leading `0x`, so `0xABCD`,
 * `0xabcd`, and `abcd` are one key. Hex case and the `0x` prefix are not part of the
 * value (the same 32 bytes either way), so folding them cannot merge two genuinely
 * distinct nonces. A caller whose nonce scope is case- or prefix-sensitive (a
 * composed key that is not plain hex) should pass their own function instead.
 */
export function canonicalNonce(nonce: string): string {
  const lower = nonce.toLowerCase();
  return lower.startsWith("0x") ? lower.slice(2) : lower;
}

/**
 * Canonicalize a resource key. When it is an absolute URL, return the parser's
 * canonical form: lowercased scheme and host and the default port dropped (all
 * case-insensitive per RFC 3986), leaving the path, query, and fragment untouched.
 * Those ARE case- and order-sensitive, so merging them would open a substitution
 * hole; normalize trailing slashes and query order yourself if a resource needs it.
 * A non-URL key (a bare path or an opaque string) is returned unchanged.
 */
export function canonicalResource(resource: string): string {
  const parsed = tryCatch(() => new URL(resource));
  return parsed.ok ? parsed.value.href : resource;
}
