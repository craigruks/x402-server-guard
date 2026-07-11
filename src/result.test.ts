import { describe, expect, it } from "vitest";
import { err, ok, type Result, tryCatch, tryCatchAsync } from "./result.js";

describe("Result", () => {
  it("ok carries the value", () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("err carries the error", () => {
    const r = err("boom");
    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("narrows exhaustively on the ok discriminant", () => {
    const r: Result<number, string> = ok(1);
    // Type-level: accessing .value is only allowed after narrowing.
    expect(r.ok ? r.value : r.error).toBe(1);
  });
});

describe("tryCatch", () => {
  it("returns ok for a value", () => {
    expect(tryCatch(() => 7)).toEqual({ ok: true, value: 7 });
  });

  it("converts a thrown Error into err", () => {
    const r = tryCatch(() => {
      throw new Error("nope");
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.message).toBe("nope");
  });

  it("coerces a thrown non-Error into an Error", () => {
    const r = tryCatch(() => {
      throw "raw string";
    });
    expect(r.ok === false && r.error instanceof Error).toBe(true);
    expect(r.ok === false && r.error.message).toBe("raw string");
  });
});

describe("tryCatchAsync", () => {
  it("returns ok for a resolved value", async () => {
    expect(await tryCatchAsync(async () => "done")).toEqual({ ok: true, value: "done" });
  });

  it("converts a rejection into err", async () => {
    const r = await tryCatchAsync(async () => {
      throw new Error("async boom");
    });
    expect(r.ok === false && r.error.message).toBe("async boom");
  });
});
