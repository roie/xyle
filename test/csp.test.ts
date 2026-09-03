import { describe, expect, it } from "vitest";
import { managedStyleCspPermits } from "../src/csp.ts";

const origin = "https://example.com";

describe("managed Layout CSP policy", () => {
  it("allows self and matching origins", () => {
    expect(managedStyleCspPermits("", ["style-src 'self'"], origin)).toBe(true);
    expect(managedStyleCspPermits("", ["style-src https://example.com"], origin)).toBe(true);
  });

  it("rejects none, nonce-only, hash-only, and other origins", () => {
    expect(managedStyleCspPermits("", ["style-src 'none'"], origin)).toBe(false);
    expect(managedStyleCspPermits("", ["style-src 'nonce-value'"], origin)).toBe(false);
    expect(managedStyleCspPermits("", ["style-src 'sha256-value'"], origin)).toBe(false);
    expect(managedStyleCspPermits("", ["style-src https://other.example"], origin)).toBe(false);
  });

  it("applies CSP meta tags in addition to response policies", () => {
    const allowed = '<meta http-equiv="Content-Security-Policy" content="style-src \'self\'">';
    const blocked = '<meta http-equiv="Content-Security-Policy" content="style-src \'none\'">';
    expect(managedStyleCspPermits(allowed, [], origin)).toBe(true);
    expect(managedStyleCspPermits(blocked, ["default-src 'self'"], origin)).toBe(false);
  });
});
