import { stableIdentity } from "./identity.ts";

/** Attributes whose values may refer to an element id within a duplicated subtree. */
export const STRUCTURAL_ID_REFERENCE_ATTRIBUTES = new Set([
  "for",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
  "aria-flowto",
  "aria-details",
  "aria-errormessage",
  "form",
  "list",
  "headers",
  "itemref",
]);

export function createdNodeIdentity(createdId: string, logicalNodeKey: string): string {
  return stableIdentity(["created-node", createdId, logicalNodeKey]);
}

export function duplicateHtmlId(createdId: string, originalId: string): string {
  return stableIdentity(["duplicate-html-id", createdId, originalId]);
}

export function duplicateGroupHtmlId(createdId: string, originalId: string): string {
  return stableIdentity(["duplicate-group-html-id", createdId, originalId]);
}

export function rewriteFragmentReference(
  value: string,
  idMap: ReadonlyMap<string, string>,
): string {
  if (!value.startsWith("#")) return value;
  const mapped = idMap.get(value.slice(1));
  return mapped ? `#${mapped}` : value;
}

export function rewriteIdTokens(value: string, idMap: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => idMap.get(token) ?? token)
    .join(" ");
}
