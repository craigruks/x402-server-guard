/**
 * Smoke-test the COMPILED package, not the TypeScript source. Imports from the
 * built `dist/` the way a consumer does and exercises the public guard API, so a
 * broken build, export map, or module resolution fails here even when the source
 * tests pass. Run after `npm run build`.
 */
import assert from "node:assert/strict";
import { createGuard, createMemoryNonceStore, guardError } from "../dist/index.js";

const params = { nonce: "0xabc", resource: "/report", expiresAt: 2_000_000_000 };

const guard = createGuard();
const first = await guard.reserve(params);
assert.equal(first.reserved, true, "first reserve should succeed");

const replay = await guard.reserve(params);
assert.equal(replay.reserved, false, "replay should be denied");
assert.equal(replay.reason.code, "nonce-already-reserved", "deny should carry the typed code");

// An already-expired authorization is denied (clock fixed at 1000, window closed at 500).
const expiredGuard = createGuard({ store: createMemoryNonceStore(() => 1000) });
const expired = await expiredGuard.reserve({ nonce: "0xexp", resource: "/report", expiresAt: 500 });
assert.equal(expired.reserved, false, "expired authorization should be denied");
assert.equal(expired.reason.code, "nonce-expired", "expiry deny should carry the typed code");

// The reserved handle can release the nonce, freeing it for a retry.
const relGuard = createGuard();
const held = await relGuard.reserve({
  nonce: "0xrelease",
  resource: "/report",
  expiresAt: 2_000_000_000,
});
assert.equal(held.reserved, true, "reserve should succeed");
const released = await held.release();
assert.equal(released.ok && released.value.status, "released", "release should free the nonce");
const reReserve = await relGuard.reserve({
  nonce: "0xrelease",
  resource: "/report",
  expiresAt: 2_000_000_000,
});
assert.equal(reReserve.reserved, true, "released nonce should reserve again");

// The store factory and error constructor are usable from the built package too.
assert.ok(typeof createMemoryNonceStore === "function", "createMemoryNonceStore exported");
assert.equal(guardError("x", "y").code, "x", "guardError exported and usable");

console.log("dist smoke: OK");
