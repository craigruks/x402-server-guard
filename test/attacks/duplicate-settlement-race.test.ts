/**
 * Attack reproduction: duplicate-settlement race (grant-before-settle).
 *
 * The baseline server delivers the resource the moment `verify()` passes, before
 * `settle()` consumes the nonce on-chain. `verify()` takes no lock, so every
 * concurrent request carrying the same payment sees an unconsumed nonce, passes,
 * and is granted. Only the first `settle()` consumes the nonce; the rest fail
 * `nonce-already-used`. Net result: N resources delivered for one settled payment.
 *
 * The first suite proves the exploit lands against the unguarded baseline. The
 * second puts the guard in front and shows it blocked: the nonce reservation holds
 * delivery to one grant per nonce, so the same concurrent flood yields a single
 * grant.
 *
 * This also covers payment replay. Resubmitting a settled payment is denied once
 * its nonce is consumed (the sequential control below), so the only replay that
 * lands is the concurrent form reproduced here. Replay needs no separate case.
 */
import { describe, expect, it } from "vitest";
import { createGuard } from "../../src/index.js";
import {
  createTestbed,
  FakeChain,
  FakeFacilitator,
  GuardedResourceServer,
  makePayment,
} from "../harness/index.js";

describe("attack: duplicate-settlement race", () => {
  it("delivers the resource to every concurrent request for one settled payment", async () => {
    const CONCURRENCY = 5;
    // A settlement-latency window guarantees all concurrent verifies land before
    // the first settle consumes the nonce, so the race is deterministic here.
    const { chain, server } = createTestbed({ settlementLatencyMs: 25 });
    const { payload, requirements } = makePayment();

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => server.handle(payload, requirements)),
    );

    const granted = results.filter((r) => r.granted).length;
    const settledOk = results.filter((r) => r.settlement?.ok === true).length;
    const settledFail = results.filter((r) => r.settlement?.ok === false).length;

    // Every concurrent request was handed the resource.
    expect(granted).toBe(CONCURRENCY);
    // Exactly one payment actually settled on-chain; the rest hit the consumed nonce.
    expect(chain.settledCount).toBe(1);
    expect(settledOk).toBe(1);
    expect(settledFail).toBe(CONCURRENCY - 1);
    // The attacker walked away with CONCURRENCY - 1 resources for free.
    expect(granted - settledOk).toBe(CONCURRENCY - 1);
  });

  it("does not reproduce when the same payment is used sequentially", async () => {
    // Control: without concurrent overlap, the first settle consumes the nonce
    // before the second request verifies, so the second is denied. This isolates
    // concurrency, not the payment itself, as the trigger.
    const { chain, server } = createTestbed({ settlementLatencyMs: 25 });
    const { payload, requirements } = makePayment();

    const first = await server.handle(payload, requirements);
    const second = await server.handle(payload, requirements);

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(chain.settledCount).toBe(1);
  });
});

describe("guarded: duplicate-settlement race", () => {
  it("grants exactly once for a concurrent flood of one payment", async () => {
    const CONCURRENCY = 5;
    const chain = new FakeChain(25);
    const server = new GuardedResourceServer(
      new FakeFacilitator(chain),
      createGuard(),
      () => "the-resource",
    );
    const { payload, requirements } = makePayment();

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => server.handle(payload, requirements)),
    );

    const granted = results.filter((r) => r.granted).length;
    // The guard reserves the nonce before delivering, so only the first request wins.
    expect(granted).toBe(1);
    expect(chain.settledCount).toBe(1);
  });

  it("denies a replay of an already-reserved payment", async () => {
    const chain = new FakeChain();
    const server = new GuardedResourceServer(
      new FakeFacilitator(chain),
      createGuard(),
      () => "the-resource",
    );
    const { payload, requirements } = makePayment();

    const first = await server.handle(payload, requirements);
    const replay = await server.handle(payload, requirements);

    expect(first.granted).toBe(true);
    expect(replay.granted).toBe(false);
    expect(chain.settledCount).toBe(1);
  });
});
