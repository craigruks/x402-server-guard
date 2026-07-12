import { describe, expect, it } from "vitest";
import { type GuardError, guardError } from "./error.js";

describe("guardError", () => {
  it("carries a code and message", () => {
    const error = guardError("verify-failed", "facilitator rejected the payment");
    expect(error.code).toBe("verify-failed");
    expect(error.message).toBe("facilitator rejected the payment");
  });

  it("omits cause when none is given", () => {
    const error = guardError("parse-failed", "malformed payload");
    expect("cause" in error).toBe(false);
  });

  it("preserves the originating throw as cause", () => {
    const original = new Error("boom");
    const error = guardError("settle-failed", "settle threw", original);
    expect(error.cause).toBe(original);
  });

  it("narrows on the code discriminant", () => {
    type Failure = GuardError<"parse-failed"> | GuardError<"verify-failed">;
    const failure: Failure = guardError("parse-failed", "malformed payload");
    // The type-level narrowing is the point; this exercises the discriminant at runtime.
    const handled = failure.code === "parse-failed" ? "parse" : "verify";
    expect(handled).toBe("parse");
  });
});
