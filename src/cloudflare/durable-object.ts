/**
 * Cloudflare Durable Object nonce store: atomic compare-and-set across isolates.
 *
 * The default in-memory store protects one process; on Workers each isolate has its
 * own Map, so N isolates would each grant one nonce N times. This routes every nonce
 * to its own Durable Object (`idFromName(nonce)`). A Durable Object serves one request
 * at a time and holds delivery of other events while a storage op to the same object
 * is in flight (input gating), so the reserve check-and-set runs atomically with no
 * lock. That is the compare-and-set the store contract requires. See the Cloudflare
 * store docs for the wrangler binding and deployment shape.
 */
import { DurableObject } from "cloudflare:workers";
import { guardError } from "../error.js";
import { err, ok, type Result, tryCatchAsync } from "../result.js";
import type {
  NonceStore,
  ReleaseOutcome,
  ReserveError,
  ReserveOutcome,
  ReserveParams,
  StoreError,
} from "../store-types.js";

interface StoredEntry {
  readonly resource: string;
  readonly expiresAt: number;
  readonly token: string;
}

const ENTRY_KEY = "entry";

/**
 * The Durable Object the guard reserves against. Bind it in wrangler and export it
 * from your Worker entry; the adapter routes each nonce to its own instance, so the
 * single stored entry per object is the reservation for that one nonce.
 */
export class NonceReservationDO extends DurableObject {
  /** Atomic reserve: input gating serializes concurrent calls to this same object. */
  async reserve(resource: string, expiresAt: number): Promise<ReserveOutcome> {
    const now = nowSeconds();
    // Refuse an already-closed window before touching storage (matches the memory store).
    if (expiresAt <= now) {
      return { status: "expired" };
    }
    const existing = await this.ctx.storage.get<StoredEntry>(ENTRY_KEY);
    // No `await` on anything but storage between the get and the put, so input gating
    // keeps this read-modify-write atomic against a concurrent reserve of the same nonce.
    if (existing !== undefined && existing.expiresAt > now) {
      return { status: "already-reserved", boundResource: existing.resource };
    }
    const token = crypto.randomUUID();
    await this.ctx.storage.put<StoredEntry>(ENTRY_KEY, { resource, expiresAt, token });
    // Evict once the window closes: past `validBefore` the nonce is unreplayable on-chain.
    await this.ctx.storage.setAlarm(expiresAt * 1000);
    return { status: "reserved", token };
  }

  /** Fenced release: free the nonce only for the holder of the matching token. */
  async release(token: string): Promise<ReleaseOutcome> {
    const entry = await this.ctx.storage.get<StoredEntry>(ENTRY_KEY);
    if (entry === undefined || entry.token !== token) {
      return { status: "not-held" };
    }
    await this.ctx.storage.deleteAll();
    return { status: "released" };
  }

  /** Cleanup: drop the entry once its window has closed. */
  override async alarm(): Promise<void> {
    const entry = await this.ctx.storage.get<StoredEntry>(ENTRY_KEY);
    if (entry !== undefined && entry.expiresAt <= nowSeconds()) {
      await this.ctx.storage.deleteAll();
    }
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** An opaque Durable Object id. A real `DurableObjectId` satisfies this. */
interface NonceReservationId {
  toString(): string;
}

/** The RPC surface the adapter calls on a {@link NonceReservationDO} stub. */
interface NonceReservationStub {
  reserve(resource: string, expiresAt: number): Promise<ReserveOutcome>;
  release(token: string): Promise<ReleaseOutcome>;
}

/**
 * The Durable Object namespace binding the adapter needs. A real
 * `DurableObjectNamespace<NonceReservationDO>` satisfies this structurally; type your
 * binding with that generic so the stub carries the reserve/release RPC methods.
 */
export interface NonceReservationNamespace {
  idFromName(name: string): NonceReservationId;
  get(id: NonceReservationId): NonceReservationStub;
}

/**
 * Build a {@link NonceStore} backed by the Durable Object namespace. Pass it to
 * `createGuard({ store })` on any multi-isolate deploy. A transport failure (the object
 * is unreachable) becomes a `store-unavailable` value, so the guard fails closed.
 */
export function createDurableObjectNonceStore(namespace: NonceReservationNamespace): NonceStore {
  const stubFor = (nonce: string): NonceReservationStub =>
    namespace.get(namespace.idFromName(nonce));
  return {
    async reserve({
      nonce,
      resource,
      expiresAt,
    }: ReserveParams): Promise<Result<ReserveOutcome, ReserveError>> {
      const outcome = await tryCatchAsync(() => stubFor(nonce).reserve(resource, expiresAt));
      return outcome.ok
        ? ok(outcome.value)
        : err(guardError("store-unavailable", "durable object reserve failed", outcome.error));
    },
    async release(nonce: string, token: string): Promise<Result<ReleaseOutcome, StoreError>> {
      const outcome = await tryCatchAsync(() => stubFor(nonce).release(token));
      return outcome.ok
        ? ok(outcome.value)
        : err(guardError("store-unavailable", "durable object release failed", outcome.error));
    },
  };
}
