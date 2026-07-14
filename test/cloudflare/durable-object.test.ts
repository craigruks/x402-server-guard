import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Boots the test Worker in real workerd (via Miniflare) once, then drives the shipped
// Durable Object nonce store over HTTP. This exercises the adapter in the runtime it
// targets, not a fake, so the atomicity claim is proven against workerd itself.
let mf: Miniflare;

beforeAll(async () => {
  const entry = fileURLToPath(new URL("./worker-entry.ts", import.meta.url));
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    write: false,
    // Provided by the workers runtime, never bundled.
    external: ["cloudflare:workers"],
  });
  const script = bundle.outputFiles[0]?.text ?? "";
  mf = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.mjs", contents: script }],
    durableObjects: { NONCE_DO: "NonceReservationDO" },
    compatibilityDate: "2026-07-08",
  });
  await mf.ready;
});

afterAll(async () => {
  await mf?.dispose();
});

// Each call routes to its own durable object (idFromName(nonce)), so distinct nonces
// are isolated without recreating Miniflare between tests.
const reserve = async (nonce: string, resource = "/r", expiresAt = 2_000_000_000) => {
  const res = await mf.dispatchFetch(
    `http://x/reserve?nonce=${nonce}&resource=${encodeURIComponent(resource)}&expiresAt=${expiresAt}`,
  );
  return res.json() as Promise<{ ok: boolean; value?: { status: string; boundResource?: string } }>;
};
const release = async (nonce: string, token: string) => {
  const res = await mf.dispatchFetch(`http://x/release?nonce=${nonce}&token=${token}`);
  return res.json() as Promise<{ ok: boolean; value?: { status: string } }>;
};

describe("durable object nonce store (in workerd)", () => {
  it("reserves a fresh nonce", async () => {
    const r = await reserve("0xfresh");
    expect(r.value?.status).toBe("reserved");
  });

  it("denies a replay of the same nonce", async () => {
    await reserve("0xreplay");
    const again = await reserve("0xreplay");
    expect(again.value?.status).toBe("already-reserved");
  });

  it("grants exactly one of N concurrent reservations of one nonce (atomic CAS)", async () => {
    // The load-bearing test: 25 racing requests hit the SAME durable object. Input
    // gating must serialize the check-and-set so exactly one wins. An in-memory store
    // cannot do this across isolates; closing that gap is why the adapter exists.
    const results = await Promise.all(Array.from({ length: 25 }, () => reserve("0xrace")));
    const reserved = results.filter((r) => r.value?.status === "reserved");
    expect(reserved).toHaveLength(1);
  });

  it("binds the nonce to its first resource", async () => {
    await reserve("0xbind", "/report-A");
    const other = await reserve("0xbind", "/report-B");
    expect(other.value?.status).toBe("already-reserved");
    expect(other.value?.boundResource).toBe("/report-A");
  });

  it("refuses an already-expired authorization", async () => {
    const r = await reserve("0xexp", "/r", 1);
    expect(r.value?.status).toBe("expired");
  });

  it("frees the nonce for the token holder, then allows a fresh reserve", async () => {
    const first = await reserve("0xrel");
    const token = (first.value as { status: string; token: string }).token;
    const released = await release("0xrel", token);
    expect(released.value?.status).toBe("released");
    const second = await reserve("0xrel");
    expect(second.value?.status).toBe("reserved");
  });

  it("does not free the nonce for a wrong token (fencing)", async () => {
    await reserve("0xfence");
    const released = await release("0xfence", "not-the-token");
    expect(released.value?.status).toBe("not-held");
    const again = await reserve("0xfence");
    expect(again.value?.status).toBe("already-reserved");
  });

  it("plugs into the guard: two encodings of one nonce fold to a single grant", async () => {
    const first = await mf.dispatchFetch("http://x/guard-reserve?nonce=0xABCD&resource=/r");
    const second = await mf.dispatchFetch("http://x/guard-reserve?nonce=0xabcd&resource=/r");
    expect(await first.json()).toEqual({ reserved: true });
    expect(await second.json()).toEqual({ reserved: false, code: "nonce-already-reserved" });
  });
});
