import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("package scaffold", () => {
  it("exports a semver version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
