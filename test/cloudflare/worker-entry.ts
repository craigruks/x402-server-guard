// Test Worker: exercises the real Durable Object nonce store over HTTP so a Node test
// can drive it inside workerd via Miniflare. Each route runs the shipped adapter
// (createDurableObjectNonceStore) against the bound namespace; the `/guard-reserve`
// route runs the full guard over that store. esbuild bundles this; workerd runs it.
import {
  createDurableObjectNonceStore,
  type NonceReservationNamespace,
} from "../../src/cloudflare/durable-object.js";
import { createGuard } from "../../src/guard.js";

export { NonceReservationDO } from "../../src/cloudflare/durable-object.js";

interface Env {
  readonly NONCE_DO: NonceReservationNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const q = url.searchParams;
    const nonce = q.get("nonce") ?? "";
    const resource = q.get("resource") ?? "/r";
    const expiresAt = Number(q.get("expiresAt") ?? "2000000000");
    const store = createDurableObjectNonceStore(env.NONCE_DO);

    if (url.pathname === "/reserve") {
      return Response.json(await store.reserve({ nonce, resource, expiresAt }));
    }
    if (url.pathname === "/release") {
      return Response.json(await store.release(nonce, q.get("token") ?? ""));
    }
    if (url.pathname === "/guard-reserve") {
      const decision = await createGuard({ store }).reserve({ nonce, resource, expiresAt });
      return Response.json(
        decision.reserved ? { reserved: true } : { reserved: false, code: decision.reason.code },
      );
    }
    return new Response("not found", { status: 404 });
  },
};
