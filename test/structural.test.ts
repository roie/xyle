import { describe, expect, it } from "vitest";
import {
  duplicateGroupHtmlId,
  duplicateHtmlId,
  duplicateIdMap,
  rewriteFragmentReference,
  rewriteIdTokens,
} from "../src/structural.ts";

describe("structural identity policy", () => {
  it("derives deterministic section and Group item HTML id maps", () => {
    const originalIds = ["heading", "description"];

    expect([...duplicateIdMap("created-1", originalIds, "section")]).toEqual([
      ["heading", duplicateHtmlId("created-1", "heading")],
      ["description", duplicateHtmlId("created-1", "description")],
    ]);
    expect([...duplicateIdMap("created-1", originalIds, "group-item")]).toEqual([
      ["heading", duplicateGroupHtmlId("created-1", "heading")],
      ["description", duplicateGroupHtmlId("created-1", "description")],
    ]);
  });

  it("rewrites only mapped fragment and token references", () => {
    const idMap = new Map([
      ["heading", "created-heading"],
      ["description", "created-description"],
    ]);

    expect(rewriteFragmentReference("#heading", idMap)).toBe("#created-heading");
    expect(rewriteFragmentReference("#unknown", idMap)).toBe("#unknown");
    expect(rewriteFragmentReference("/page#heading", idMap)).toBe("/page#heading");
    expect(rewriteIdTokens("heading unknown description", idMap)).toBe(
      "created-heading unknown created-description",
    );
  });
});
