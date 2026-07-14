/**
 * Canonical keys for the nonce and the resource.
 *
 * The guard uses the nonce and resource strings directly as map keys. If one nonce (or
 * resource) reaches the guard in two encodings, the two forms become two keys for one
 * payment: the string-encoding cousin of signature malleability. `createGuard` folds
 * these encodings by default; a caller with a case- or prefix-sensitive scope can
 * override or opt out (see GuardOptions).
 */

import { tryCatch } from "./result.js";

/**
 * Canonicalize a payment nonce: lowercase it and drop a leading `0x`, so `0xABCD`,
 * `0xabcd`, and `abcd` are one key. Hex case and the `0x` prefix are not part of the
 * value (the same bytes either way), so folding them cannot merge two distinct nonces.
 * A caller whose nonce scope is case- or prefix-sensitive should pass their own function.
 */
export function canonicalNonce(nonce: string): string {
  const lower = nonce.toLowerCase();
  return lower.startsWith("0x") ? lower.slice(2) : lower;
}

/**
 * Canonicalize a resource key. When it is an absolute URL, return the WHATWG-URL
 * canonical form: scheme and host case-folded, the default port dropped, and
 * dot-segments resolved. It does NOT decode percent-encoded octets (`%41` stays
 * `%41`, not `A`), so this is not full RFC 3986 equivalence; two RFC-equivalent paths
 * that differ only in percent-encoding get different keys. Path, query, and fragment
 * CASE is preserved, so `/Foo` and `/foo` stay distinct and merging cannot open a
 * substitution hole; normalize trailing slashes and query order yourself if a resource
 * needs it. A non-URL key (a bare path or an opaque string) is returned unchanged.
 * Note: the URL parser's IDN/punycode output can vary with the runtime's ICU, so a
 * persistent distributed store should pin a stable resource form rather than rely on
 * this across engine upgrades.
 */
export function canonicalResource(resource: string): string {
  const parsed = tryCatch(() => new URL(resource));
  return parsed.ok ? parsed.value.href : resource;
}
