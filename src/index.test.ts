import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "./index.js";

describe("package scaffold", () => {
  it("exports a semver version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("keeps VERSION in lockstep with package.json (scripts/sync-version.mjs)", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
