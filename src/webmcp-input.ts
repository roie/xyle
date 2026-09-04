import type { LayoutPreset, RegionOrder, SeoField } from "./types.ts";
import type { ChangeSetOperation, Formatting, MediaPatchInput } from "./webmcp-contracts.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSeoInput(value: unknown): { field: SeoField; value: string } {
  if (!isRecord(value) || typeof value.field !== "string" || typeof value.value !== "string") {
    throw new Error("update_seo requires string fields field and value");
  }
  const fields: SeoField[] = [
    "title",
    "description",
    "canonical",
    "ogTitle",
    "ogDescription",
    "ogImage",
  ];
  if (!fields.includes(value.field as SeoField))
    throw new Error("update_seo field is not supported");
  return { field: value.field as SeoField, value: value.value };
}

export function parseIdInput(value: unknown, toolName: string): string {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error(`${toolName} requires a string id`);
  }
  return value.id;
}

export function parseTextInsertionInput(
  value: unknown,
  toolName: string,
): { id: string; offset: number } {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.offset) ||
    (value.offset as number) < 0
  ) {
    throw new Error(`${toolName} requires a string id and a non-negative integer offset`);
  }
  return { id: value.id, offset: value.offset as number };
}

export function parseCreateLinkInput(value: unknown): {
  id: string;
  start: number;
  end: number;
  href: string;
} {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.start) ||
    !Number.isInteger(value.end) ||
    (value.start as number) < 0 ||
    (value.end as number) <= (value.start as number) ||
    typeof value.href !== "string"
  ) {
    throw new Error(
      "create_link requires a string id and href with non-negative integer start and end offsets",
    );
  }
  return {
    id: value.id,
    start: value.start as number,
    end: value.end as number,
    href: value.href,
  };
}

export function parseGroupItemInput(value: unknown): { groupId: string; itemId: string } {
  if (!isRecord(value) || typeof value.groupId !== "string" || typeof value.itemId !== "string") {
    throw new Error("duplicate_group_item requires string groupId and itemId");
  }
  return { groupId: value.groupId, itemId: value.itemId };
}

export function parseMoveGroupItemInput(value: unknown): {
  groupId: string;
  itemId: string;
  targetItemId: string;
  position: "before" | "after";
} {
  if (
    !isRecord(value) ||
    typeof value.groupId !== "string" ||
    typeof value.itemId !== "string" ||
    typeof value.targetItemId !== "string" ||
    (value.position !== "before" && value.position !== "after")
  ) {
    throw new Error(
      "move_group_item requires string groupId, itemId, targetItemId, and position before or after",
    );
  }
  return {
    groupId: value.groupId,
    itemId: value.itemId,
    targetItemId: value.targetItemId,
    position: value.position,
  };
}

export function parseLayoutTargetInput(value: unknown): string {
  if (!isRecord(value) || typeof value.targetId !== "string") {
    throw new Error("layout target requires a string targetId");
  }
  return value.targetId;
}

export function parseSetRegionOrderInput(value: unknown): { targetId: string; order: RegionOrder } {
  if (!isRecord(value) || typeof value.targetId !== "string" || typeof value.order !== "string") {
    throw new Error("set_region_order requires string targetId and order");
  }
  if (value.order !== "original" && value.order !== "swapped") {
    throw new Error("set_region_order order is not supported");
  }
  return { targetId: value.targetId, order: value.order };
}

export function parseSetLayoutInput(value: unknown): { targetId: string; preset: LayoutPreset } {
  if (!isRecord(value) || typeof value.targetId !== "string" || typeof value.preset !== "string") {
    throw new Error("set_layout requires string targetId and preset");
  }
  if (value.preset !== "stacked" && value.preset !== "two-column") {
    throw new Error("set_layout preset is not supported");
  }
  return { targetId: value.targetId, preset: value.preset };
}

export function parseChangeIdInput(value: unknown): string {
  if (!isRecord(value) || typeof value.changeId !== "string") {
    throw new Error("revert_change requires a string changeId");
  }
  return value.changeId;
}

export function parseSectionVisibilityInput(value: unknown): { id: string; visible: boolean } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.visible !== "boolean") {
    throw new Error("section visibility requires a string id and boolean visible");
  }
  return { id: value.id, visible: value.visible };
}

export function parseMoveSectionInput(value: unknown): {
  id: string;
  targetId: string;
  before: boolean;
} {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.targetId !== "string" ||
    typeof value.before !== "boolean"
  ) {
    throw new Error("move_section requires string id, targetId, and boolean before");
  }
  return { id: value.id, targetId: value.targetId, before: value.before };
}

export function parseTextUpdateInput(value: unknown): { id: string; text: string } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    throw new Error("update_text requires string fields id and text");
  }
  return { id: value.id, text: value.text };
}

export function parseMediaInput(value: unknown): { id: string; patch: MediaPatchInput } {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("update_media requires a string id");
  }
  const patch: MediaPatchInput = {};
  if (value.src !== undefined) {
    if (typeof value.src !== "string") throw new Error("update_media src must be a string");
    patch.src = value.src;
  }
  if (value.alt !== undefined) {
    if (typeof value.alt !== "string") throw new Error("update_media alt must be a string");
    patch.alt = value.alt;
  }
  if (value.fit !== undefined) {
    if (value.fit !== "cover" && value.fit !== "contain") {
      throw new Error("update_media fit must be cover or contain");
    }
    patch.fit = value.fit;
  }
  for (const name of ["crop", "focus"] as const) {
    const point = value[name];
    if (point === null) {
      patch[name] = null;
      continue;
    }
    if (point !== undefined) {
      if (!isRecord(point) || typeof point.x !== "number" || typeof point.y !== "number") {
        throw new Error(`update_media ${name} requires numeric x and y`);
      }
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1
      ) {
        throw new Error(`update_media ${name} coordinates must be between 0 and 1`);
      }
      if (name === "crop") {
        if (typeof point.width !== "number" || typeof point.height !== "number") {
          throw new Error("update_media crop requires numeric width and height");
        }
        if (
          !Number.isFinite(point.width) ||
          !Number.isFinite(point.height) ||
          point.width <= 0 ||
          point.height <= 0 ||
          point.width > 1 ||
          point.height > 1 ||
          point.x + point.width > 1 ||
          point.y + point.height > 1
        ) {
          throw new Error("update_media crop rectangle is outside the image");
        }
        patch.crop = { x: point.x, y: point.y, width: point.width, height: point.height };
      } else {
        patch.focus = { x: point.x, y: point.y };
      }
    }
  }
  if (Object.keys(patch).length === 0) throw new Error("update_media requires a media property");
  return { id: value.id, patch };
}

export function parseAssetInput(value: unknown): { id: string; src: string; alt?: string } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.src !== "string") {
    throw new Error("replace_asset requires string fields id and src");
  }
  if (value.alt !== undefined && typeof value.alt !== "string") {
    throw new Error("replace_asset alt must be a string");
  }
  return {
    id: value.id,
    src: value.src,
    ...(value.alt !== undefined ? { alt: value.alt } : {}),
  };
}

export function parseListFormattingInput(value: unknown): {
  ids: string[];
  format: "unordered-list" | "ordered-list";
} {
  if (!isRecord(value) || !Array.isArray(value.ids) || typeof value.format !== "string") {
    throw new Error("update_list requires string[] ids and a list format");
  }
  if (
    value.ids.length < 1 ||
    value.ids.length > 20 ||
    value.ids.some((id) => typeof id !== "string" || !id) ||
    new Set(value.ids).size !== value.ids.length ||
    (value.format !== "unordered-list" && value.format !== "ordered-list")
  ) {
    throw new Error("update_list requires 1 to 20 unique text block ids");
  }
  return { ids: value.ids, format: value.format };
}

export function parseFormattingInput(value: unknown): { id: string; format: Formatting } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.format !== "string") {
    throw new Error("update_formatting requires string fields id and format");
  }
  const formats: Formatting[] = [
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "paragraph",
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-4",
    "heading-5",
    "heading-6",
    "unordered-list",
    "ordered-list",
  ];
  if (!formats.includes(value.format as Formatting)) {
    throw new Error("update_formatting format is not supported");
  }
  return { id: value.id, format: value.format as Formatting };
}

export function parseLinkUpdateInput(value: unknown): { id: string; text?: string; href?: string } {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("update_link requires a string id");
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    throw new Error("update_link text must be a string");
  }
  if (value.href !== undefined && typeof value.href !== "string") {
    throw new Error("update_link href must be a string");
  }
  if (value.text === undefined && value.href === undefined) {
    throw new Error("update_link requires text or href");
  }
  return {
    id: value.id,
    ...(value.text !== undefined ? { text: value.text } : {}),
    ...(value.href !== undefined ? { href: value.href } : {}),
  };
}

export function parseChangeSetInput(value: unknown): {
  label: string;
  changes: ChangeSetOperation[];
} {
  if (!isRecord(value) || typeof value.label !== "string") {
    throw new Error("apply_change_set requires a string label");
  }
  const label = value.label.trim();
  if (!label || label.length > 100) {
    throw new Error("apply_change_set label must be 1 to 100 characters");
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 20) {
    throw new Error("apply_change_set requires 1 to 20 changes");
  }
  const ids = new Set<string>();
  const changes: ChangeSetOperation[] = [];
  for (const rawChange of value.changes) {
    if (!isRecord(rawChange) || typeof rawChange.id !== "string" || !rawChange.id) {
      throw new Error("Each change requires a string id");
    }
    if (ids.has(rawChange.id)) throw new Error(`Duplicate change target ${rawChange.id}`);
    ids.add(rawChange.id);
    if (rawChange.type === "text") {
      if (typeof rawChange.text !== "string") throw new Error("Text changes require a string text");
      changes.push({ type: "text", id: rawChange.id, text: rawChange.text });
      continue;
    }
    if (rawChange.type === "link") {
      if (rawChange.text !== undefined && typeof rawChange.text !== "string") {
        throw new Error("Link change text must be a string");
      }
      if (rawChange.href !== undefined && typeof rawChange.href !== "string") {
        throw new Error("Link change href must be a string");
      }
      if (rawChange.text === undefined && rawChange.href === undefined) {
        throw new Error("Link changes require text or href");
      }
      changes.push({
        type: "link",
        id: rawChange.id,
        ...(rawChange.text !== undefined ? { text: rawChange.text } : {}),
        ...(rawChange.href !== undefined ? { href: rawChange.href } : {}),
      });
      continue;
    }
    if (rawChange.type === "asset") {
      if (typeof rawChange.src !== "string") throw new Error("Asset changes require a string src");
      if (rawChange.alt !== undefined && typeof rawChange.alt !== "string") {
        throw new Error("Asset change alt must be a string");
      }
      changes.push({
        type: "asset",
        id: rawChange.id,
        src: rawChange.src,
        ...(rawChange.alt !== undefined ? { alt: rawChange.alt } : {}),
      });
      continue;
    }
    if (rawChange.type === "sectionVisibility") {
      if (typeof rawChange.visible !== "boolean") {
        throw new Error("Section visibility changes require a boolean visible");
      }
      changes.push({ type: "sectionVisibility", id: rawChange.id, visible: rawChange.visible });
      continue;
    }
    if (rawChange.type === "moveSection") {
      if (typeof rawChange.targetId !== "string" || typeof rawChange.before !== "boolean") {
        throw new Error("Section move changes require targetId and before");
      }
      changes.push({
        type: "moveSection",
        id: rawChange.id,
        targetId: rawChange.targetId,
        before: rawChange.before,
      });
      continue;
    }
    if (rawChange.type === "formatting") {
      const formats: Formatting[] = [
        "bold",
        "italic",
        "underline",
        "strikethrough",
        "paragraph",
        "heading-1",
        "heading-2",
        "heading-3",
        "heading-4",
        "heading-5",
        "heading-6",
        "unordered-list",
        "ordered-list",
      ];
      if (!formats.includes(rawChange.format as Formatting)) {
        throw new Error("Formatting changes require a supported format");
      }
      changes.push({
        type: "formatting",
        id: rawChange.id,
        format: rawChange.format as Formatting,
      });
      continue;
    }
    throw new Error(
      "Change type must be text, link, asset, formatting, sectionVisibility, or moveSection",
    );
  }
  return { label, changes };
}

export function parseChangeSetIdInput(value: unknown): string {
  if (!isRecord(value) || typeof value.changeSetId !== "string") {
    throw new Error("undo_change_set requires a string changeSetId");
  }
  return value.changeSetId;
}
