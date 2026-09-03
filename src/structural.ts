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

export function duplicateIdMap(
  createdId: string,
  originalIds: Iterable<string>,
  kind: "section" | "group-item",
): Map<string, string> {
  const identity = kind === "section" ? duplicateHtmlId : duplicateGroupHtmlId;
  return new Map(
    [...originalIds].map((originalId) => [originalId, identity(createdId, originalId)]),
  );
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
    .flatMap((token) => (token ? [idMap.get(token) ?? token] : []))
    .join(" ");
}

export type GroupOrderOperation =
  | {
      type: "duplicateGroupItem";
      sourceItemId: string;
      createdId: string;
      sequence: number;
    }
  | {
      type: "moveGroupItem";
      itemId: string;
      targetItemId: string;
      position: "before" | "after";
      sequence: number;
    };

/** Replay Group ordering without interpreting CSS or content. */
export function replayGroupOrder(
  sourceItemIds: readonly string[],
  operations: readonly GroupOrderOperation[],
): string[] {
  const sourceIds = new Set(sourceItemIds);
  if (sourceIds.size !== sourceItemIds.length) throw new Error("Group source order is ambiguous");
  const entries = sourceItemIds.map((id) => ({ id, originId: id }));
  for (const operation of [...operations].sort((left, right) => left.sequence - right.sequence)) {
    if (operation.type === "duplicateGroupItem") {
      if (!sourceIds.has(operation.sourceItemId))
        throw new Error("Group duplication source is not source-backed");
      const insertAfter = entries.reduce(
        (last, entry, index) => (entry.originId === operation.sourceItemId ? index : last),
        -1,
      );
      if (insertAfter < 0) throw new Error("Group duplication source is unavailable");
      entries.splice(insertAfter + 1, 0, {
        id: operation.createdId,
        originId: operation.sourceItemId,
      });
      continue;
    }
    if (
      !sourceIds.has(operation.itemId) ||
      !sourceIds.has(operation.targetItemId) ||
      operation.itemId === operation.targetItemId
    ) {
      throw new Error("Group move must use distinct source-backed items");
    }
    const sourceIndex = entries.findIndex((entry) => entry.id === operation.itemId);
    const targetIndex = entries.findIndex((entry) => entry.id === operation.targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error("Group move target is unavailable");
    const [source] = entries.splice(sourceIndex, 1);
    if (!source) throw new Error("Group move source is unavailable");
    const adjustedTargetIndex = entries.findIndex((entry) => entry.id === operation.targetItemId);
    entries.splice(adjustedTargetIndex + (operation.position === "after" ? 1 : 0), 0, source);
  }
  return entries.map((entry) => entry.id);
}
