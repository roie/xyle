import type { CropRect, MediaCapabilities, Point } from "./types.ts";

export interface EditableContent {
  id: string;
  type: "text" | "link" | "image";
  preview: string;
  capabilities?: MediaCapabilities;
}

export interface ContentResult {
  id: string;
  type: "text" | "link" | "image";
  content: string;
  alt?: string;
}

export interface TextUpdateResult {
  id: string;
  pagePath: string;
  text: string;
}

export interface LinkUpdateResult {
  id: string;
  pagePath: string;
  text: string;
  href: string;
}

export interface AssetUpdateResult {
  id: string;
  pagePath: string;
  src: string;
  alt: string;
}

export interface MediaPatchInput {
  src?: string;
  alt?: string;
  crop?: CropRect | null;
  focus?: Point | null;
  fit?: "cover" | "contain";
}

export interface MediaUpdateResult {
  id: string;
  pagePath: string;
  src: string;
  alt: string;
}

export type Formatting =
  | "bold"
  | "italic"
  | "underline"
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6";

export interface FormattingUpdateResult {
  id: string;
  pagePath: string;
  format: Formatting;
}

export interface ChangeInfo {
  changeId: string;
  elementId: string;
  type:
    | "text"
    | "href"
    | "src"
    | "alt"
    | "format"
    | "formatBlock"
    | "html"
    | "imageStyle"
    | "media";
  before: string;
  after: string;
  changeSetId?: string;
  changeSetLabel?: string;
}

export interface UndoResult {
  changeId: string;
  undone: true;
}

export type ChangeSetOperation =
  | { type: "text"; id: string; text: string }
  | { type: "link"; id: string; text?: string; href?: string }
  | { type: "asset"; id: string; src: string; alt?: string }
  | { type: "formatting"; id: string; format: Formatting };

export interface ChangeSetResult {
  changeSetId: string;
  label: string;
  changes: ChangeInfo[];
}

export interface ChangeSetUndoResult {
  changeSetId: string;
  undone: true;
}

export interface WebMcpBridge {
  listEditableContent(): EditableContent[];
  getContent(id: string): ContentResult;
  listChanges(): ChangeInfo[];
  undoChange(changeId: string): UndoResult;
  applyChangeSet(label: string, changes: ChangeSetOperation[]): ChangeSetResult;
  undoChangeSet(changeSetId: string): ChangeSetUndoResult;
  replaceAsset(id: string, src: string, alt?: string): AssetUpdateResult;
  updateMedia?: (id: string, patch: MediaPatchInput) => MediaUpdateResult;
  updateFormatting(id: string, format: Formatting): FormattingUpdateResult;
  updateText(id: string, text: string): TextUpdateResult;
  updateLink(id: string, text?: string, href?: string): LinkUpdateResult;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown, context?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
}

interface ModelContextLike {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
}

function textResult(value: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: value }] };
}

function modelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  return (document as Document & { modelContext?: ModelContextLike }).modelContext ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIdInput(value: unknown, toolName: string): string {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error(`${toolName} requires a string id`);
  }
  return value.id;
}

function parseChangeIdInput(value: unknown): string {
  if (!isRecord(value) || typeof value.changeId !== "string") {
    throw new Error("undo_change requires a string changeId");
  }
  return value.changeId;
}

function parseTextUpdateInput(value: unknown): { id: string; text: string } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    throw new Error("update_text requires string fields id and text");
  }
  return { id: value.id, text: value.text };
}

function parseMediaInput(value: unknown): { id: string; patch: MediaPatchInput } {
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

function parseAssetInput(value: unknown): { id: string; src: string; alt?: string } {
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

function parseFormattingInput(value: unknown): { id: string; format: Formatting } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.format !== "string") {
    throw new Error("update_formatting requires string fields id and format");
  }
  const formats: Formatting[] = [
    "bold",
    "italic",
    "underline",
    "paragraph",
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-4",
    "heading-5",
    "heading-6",
  ];
  if (!formats.includes(value.format as Formatting)) {
    throw new Error("update_formatting format is not supported");
  }
  return { id: value.id, format: value.format as Formatting };
}

function parseLinkUpdateInput(value: unknown): { id: string; text?: string; href?: string } {
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

function parseChangeSetInput(value: unknown): { label: string; changes: ChangeSetOperation[] } {
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
    if (rawChange.type === "formatting") {
      const formats: Formatting[] = [
        "bold",
        "italic",
        "underline",
        "paragraph",
        "heading-1",
        "heading-2",
        "heading-3",
        "heading-4",
        "heading-5",
        "heading-6",
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
    throw new Error("Change type must be text, link, asset, or formatting");
  }
  return { label, changes };
}

function parseChangeSetIdInput(value: unknown): string {
  if (!isRecord(value) || typeof value.changeSetId !== "string") {
    throw new Error("undo_change_set requires a string changeSetId");
  }
  return value.changeSetId;
}

export async function registerWebMcpTools(
  bridge: WebMcpBridge,
  providedContext?: ModelContextLike,
): Promise<(() => void) | null> {
  const context = providedContext ?? modelContext();
  if (!context) return null;

  const controller = new AbortController();
  try {
    await context.registerTool(
      {
        name: "list_editable_content",
        description: "List the current page regions that Xyle can edit.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (_input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          return textResult(JSON.stringify(bridge.listEditableContent()));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "get_content",
        description: "Read the current content of one Xyle editable region.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "The editable Xyle node id." } },
          required: ["id"],
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          return textResult(JSON.stringify(bridge.getContent(parseIdInput(input, "get_content"))));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "list_changes",
        description: "List the current unsaved Xyle changes.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (_input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          return textResult(JSON.stringify(bridge.listChanges()));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "apply_change_set",
        description: "Apply several safe Xyle edits as one reviewable and undoable task.",
        inputSchema: {
          type: "object",
          properties: {
            label: { type: "string", description: "A short name for this editing task." },
            changes: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["text", "link", "asset", "formatting"] },
                  id: { type: "string", description: "The current Xyle node id." },
                  text: { type: "string", description: "Replacement text." },
                  href: { type: "string", description: "A safe URL or path." },
                  src: { type: "string", description: "A safe image URL or path." },
                  alt: { type: "string", description: "Alternative text for an image." },
                  format: {
                    type: "string",
                    enum: [
                      "bold",
                      "italic",
                      "underline",
                      "paragraph",
                      "heading-1",
                      "heading-2",
                      "heading-3",
                      "heading-4",
                      "heading-5",
                      "heading-6",
                    ],
                  },
                },
                required: ["type", "id"],
              },
            },
          },
          required: ["label", "changes"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseChangeSetInput(input);
          return textResult(JSON.stringify(bridge.applyChangeSet(parsed.label, parsed.changes)));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "undo_change_set",
        description: "Undo every current Xyle change created by one editing task.",
        inputSchema: {
          type: "object",
          properties: { changeSetId: { type: "string", description: "The Xyle change-set id." } },
          required: ["changeSetId"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          return textResult(JSON.stringify(bridge.undoChangeSet(parseChangeSetIdInput(input))));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "undo_change",
        description: "Undo one current unsaved Xyle change.",
        inputSchema: {
          type: "object",
          properties: { changeId: { type: "string", description: "The Xyle change id." } },
          required: ["changeId"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          return textResult(JSON.stringify(bridge.undoChange(parseChangeIdInput(input))));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "update_link",
        description: "Update the text or safe destination of one Xyle link.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The editable Xyle link id." },
            text: { type: "string", description: "Optional replacement link text." },
            href: { type: "string", description: "Optional safe URL or path." },
          },
          required: ["id"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseLinkUpdateInput(input);
          return textResult(JSON.stringify(bridge.updateLink(parsed.id, parsed.text, parsed.href)));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "replace_asset",
        description: "Replace one Xyle image source and optionally update its alt text.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The current Xyle image id." },
            src: { type: "string", description: "A safe image URL or site path." },
            alt: { type: "string", description: "Optional alternative text." },
          },
          required: ["id", "src"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseAssetInput(input);
          return textResult(JSON.stringify(bridge.replaceAsset(parsed.id, parsed.src, parsed.alt)));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "update_media",
        description: "Safely update one image source, crop, focus point, or alt text.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The current Xyle image id." },
            src: { type: "string", description: "A safe image URL or site path." },
            alt: { type: "string", description: "Alternative text for the image." },
            fit: { type: "string", enum: ["cover", "contain"] },
            crop: {
              type: ["object", "null"],
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
              },
            },
            focus: {
              type: ["object", "null"],
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          required: ["id"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseMediaInput(input);
          if (!bridge.updateMedia) throw new Error("update_media is unavailable");
          return textResult(JSON.stringify(bridge.updateMedia(parsed.id, parsed.patch)));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "update_formatting",
        description:
          "Apply safe inline formatting or a paragraph/heading block style to one Xyle text region.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The current Xyle text or link id." },
            format: {
              type: "string",
              enum: [
                "bold",
                "italic",
                "underline",
                "paragraph",
                "heading-1",
                "heading-2",
                "heading-3",
                "heading-4",
                "heading-5",
                "heading-6",
              ],
            },
          },
          required: ["id", "format"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseFormattingInput(input);
          return textResult(JSON.stringify(bridge.updateFormatting(parsed.id, parsed.format)));
        },
      },
      { signal: controller.signal },
    );
    await context.registerTool(
      {
        name: "update_text",
        description: "Replace the text in one current Xyle editable region.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The editable Xyle node id." },
            text: { type: "string", description: "The replacement plain text." },
          },
          required: ["id", "text"],
        },
        annotations: { untrustedContentHint: true },
        execute: async (input, context) => {
          if (context?.signal?.aborted) {
            throw new DOMException("Tool execution canceled", "AbortError");
          }
          const parsed = parseTextUpdateInput(input);
          return textResult(JSON.stringify(bridge.updateText(parsed.id, parsed.text)));
        },
      },
      { signal: controller.signal },
    );
  } catch {
    controller.abort();
    return null;
  }

  return () => controller.abort();
}
