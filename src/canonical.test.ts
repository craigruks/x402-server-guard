import { describe, expect, it } from "vitest";
import { canonicalNonce, canonicalResource } from "./canonical.js";

describe("canonicalNonce", () => {
  it("folds hex case and the 0x prefix to one key", () => {
    const forms = ["0xABCD", "0xabcd", "abcd", "0Xabcd", "ABCD"];
    const keys = new Set(forms.map(canonicalNonce));
    expect(keys).toEqual(new Set(["abcd"]));
  });

  it("keeps distinct nonces distinct", () => {
    expect(canonicalNonce("0xabcd")).not.toBe(canonicalNonce("0xabce"));
  });

  it("leaves a non-hex-prefixed key lowercased", () => {
    expect(canonicalNonce("Chain1:PAYER")).toBe("chain1:payer");
  });
});

describe("canonicalResource", () => {
  it("folds URL scheme and host casing, and the default port", () => {
    expect(canonicalResource("HTTPS://API.Example.COM:443/Report")).toBe(
      "https://api.example.com/Report",
    );
  });

  it("preserves case-sensitive path, query, and fragment", () => {
    const r = "https://api.example.com/Path/To?B=2&a=1#Frag";
    expect(canonicalResource(r)).toBe(r);
  });

  it("does not merge distinct paths (no substitution hole)", () => {
    expect(canonicalResource("https://a.com/Foo")).not.toBe(canonicalResource("https://a.com/foo"));
  });

  it("returns a bare path or opaque key unchanged", () => {
    expect(canonicalResource("/report")).toBe("/report");
    expect(canonicalResource("opaque-key")).toBe("opaque-key");
  });
});
