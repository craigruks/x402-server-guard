import { describe, expect, it } from "vitest";
import { MemoryNonceStore } from "./nonce-store.js";

const params = (nonce: string, resource = "/r", expiresAt = 2_000_000_000) => ({
  nonce,
  resource,
  expiresAt,
});

describe("MemoryNonceStore", () => {
  it("reserves a fresh nonce", async () => {
    const store = new MemoryNonceStore();
    expect(await store.reserve(params("0xabc"))).toEqual({
      ok: true,
      value: { status: "reserved", token: expect.any(String) },
    });
  });

  it("denies a second reserve and returns the bound resource", async () => {
    const store = new MemoryNonceStore();
    await store.reserve(params("0xabc", "/a"));
    expect(await store.reserve(params("0xabc", "/b"))).toEqual({
      ok: true,
      value: { status: "already-reserved", boundResource: "/a" },
    });
  });

  it("reserves distinct nonces independently", async () => {
    const store = new MemoryNonceStore();
    expect(await store.reserve(params("0xa"))).toEqual({
      ok: true,
      value: { status: "reserved", token: expect.any(String) },
    });
    expect(await store.reserve(params("0xb"))).toEqual({
      ok: true,
      value: { status: "reserved", token: expect.any(String) },
    });
  });

  it("is atomic: only one of N concurrent reserves of one nonce wins", async () => {
    const store = new MemoryNonceStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.reserve(params("0xrace"))),
    );
    const reserved = results.filter((r) => r.ok && r.value.status === "reserved").length;
    expect(reserved).toBe(1);
  });

  it("refuses an authorization that is already expired", async () => {
    const store = new MemoryNonceStore(() => 1000);
    expect(await store.reserve(params("0xexp", "/r", 500))).toEqual({
      ok: true,
      value: { status: "expired" },
    });
    // An expired reserve must not occupy the slot: the nonce stays unreserved.
    expect(store.size).toBe(0);
  });

  it("re-reserves a nonce whose authorization has expired", async () => {
    let clock = 1000;
    const store = new MemoryNonceStore(() => clock);
    await store.reserve(params("0xexp", "/r", 1010));
    clock = 1020;
    expect(await store.reserve(params("0xexp", "/r", 1030))).toEqual({
      ok: true,
      value: { status: "reserved", token: expect.any(String) },
    });
  });

  it("rejects a fresh reservation once at capacity, failing closed", async () => {
    const store = new MemoryNonceStore(() => 1000, 2); // cap of 2
    expect((await store.reserve(params("0xa", "/r", 5000))).ok).toBe(true);
    expect((await store.reserve(params("0xb", "/r", 5000))).ok).toBe(true);

    // Full: a fresh nonce is rejected as an error value (fail closed), not stored.
    expect(await store.reserve(params("0xc", "/r", 5000))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "store-at-capacity" }),
    });
    expect(store.size).toBe(2);

    // An already-reserved nonce still resolves at capacity (it needs no new slot).
    expect(await store.reserve(params("0xa", "/other", 5000))).toEqual({
      ok: true,
      value: { status: "already-reserved", boundResource: "/r" },
    });
  });

  it("sweeps expired reservations but keeps still-valid ones", async () => {
    let clock = 1000;
    const store = new MemoryNonceStore(() => clock);
    for (let i = 0; i < 50; i += 1) {
      await store.reserve(params(`0x${i}`, "/r", 1010)); // expire at 1010
    }
    await store.reserve(params("0xlive", "/r", 5000)); // still valid well past the sweep
    expect(store.size).toBe(51);

    clock = 1080; // past the 60s sweep interval and past the 1010 expiries
    await store.reserve(params("0xfresh", "/r", 3000)); // triggers a sweep
    // The 50 expired are dropped; the live one and the fresh one remain.
    expect(store.size).toBe(2);
  });

  it("releases a reservation for the holder of the token, freeing the nonce", async () => {
    const store = new MemoryNonceStore();
    const reserved = await store.reserve(params("0xr"));
    if (!reserved.ok || reserved.value.status !== "reserved") throw new Error("expected reserved");
    const { token } = reserved.value;

    expect(await store.release("0xr", token)).toEqual({ ok: true, value: { status: "released" } });
    expect(store.size).toBe(0);
    // Freed: the nonce can be reserved again.
    expect((await store.reserve(params("0xr"))).ok).toBe(true);
  });

  it("does not release with a wrong token (fencing)", async () => {
    const store = new MemoryNonceStore();
    await store.reserve(params("0xr"));
    expect(await store.release("0xr", "not-the-token")).toEqual({
      ok: true,
      value: { status: "not-held" },
    });
    expect(store.size).toBe(1); // still reserved
  });

  it("releasing an unknown nonce frees nothing", async () => {
    const store = new MemoryNonceStore();
    expect(await store.release("0xnope", "any")).toEqual({
      ok: true,
      value: { status: "not-held" },
    });
  });
});
