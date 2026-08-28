import { describe, expect, it } from "vitest";
import { sourceTargetIdentity, stableIdentity } from "../src/identity.ts";

describe("source-backed editor identities", () => {
  it("is deterministic and opaque", () => {
    const parts = ["/index.html", "image", "12", "58"];
    expect(stableIdentity(parts)).toBe(stableIdentity([...parts]));
    expect(stableIdentity(parts)).toMatch(/^x-[0-9a-f]{8}$/);
    expect(stableIdentity(parts)).not.toContain("/index.html");
  });

  it("changes when the source target changes", () => {
    expect(sourceTargetIdentity("/index.html", "image", 12, 58, "img")).not.toBe(
      sourceTargetIdentity("/index.html", "image", 13, 58, "img"),
    );
  });
});
