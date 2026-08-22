import { describe, expect, it } from "vitest";
import { evaluateDeployGuard } from "../src/cli.ts";
import type { XyleDigest } from "../src/types.ts";

const A = "sha256:" + "a".repeat(64) as XyleDigest;
const B = "sha256:" + "b".repeat(64) as XyleDigest;

describe("developer redeploy guard", () => {
  it("allows the first managed deployment", () => {
    expect(evaluateDeployGuard(null, A).allowed).toBe(true);
  });

  it("allows redeploys when remote is unchanged", () => {
    expect(evaluateDeployGuard(A, A).allowed).toBe(true);
  });

  it("refuses stale redeploys by default", () => {
    const decision = evaluateDeployGuard(A, B);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/refusing to overwrite/i);
    expect(decision.reason).toMatch(/changes made after your last managed deployment/i);
  });

  it("never infers consent; force must be explicit", () => {
    expect(evaluateDeployGuard(A, B, true).allowed).toBe(true);
    expect(evaluateDeployGuard(A, B, false).allowed).toBe(false);
  });
});
