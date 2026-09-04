import type { WebMcpBridge } from "./webmcp-contracts.ts";
export type {
  AssetUpdateResult,
  ChangeInfo,
  ChangeSetOperation,
  ChangeSetResult,
  ChangeSetUndoResult,
  ContentResult,
  EditableContent,
  Formatting,
  FormattingUpdateResult,
  LinkUpdateResult,
  ListFormattingUpdateResult,
  MediaPatchInput,
  MediaUpdateResult,
  SeoUpdateResult,
  TextUpdateResult,
  UndoResult,
  WebMcpBridge,
} from "./webmcp-contracts.ts";
import {
  parseAssetInput,
  parseChangeIdInput,
  parseChangeSetIdInput,
  parseChangeSetInput,
  parseCreateLinkInput,
  parseFormattingInput,
  parseGroupItemInput,
  parseIdInput,
  parseLayoutOutcomeInput,
  parseLayoutTargetInput,
  parseLinkUpdateInput,
  parseListFormattingInput,
  parseMediaInput,
  parseMoveGroupItemInput,
  parseMoveSectionInput,
  parseSeoInput,
  parseSectionVisibilityInput,
  parseTextUpdateInput,
  parseTextInsertionInput,
} from "./webmcp-input.ts";

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

function toolErrorResult(error: unknown): ReturnType<typeof textResult> {
  const message = error instanceof Error ? error.message : "Tool execution failed";
  return textResult(JSON.stringify({ error: message }));
}

async function registerReportingTool(
  context: ModelContextLike,
  tool: ModelContextTool,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const execute = tool.execute;
  await context.registerTool(
    {
      ...tool,
      execute: async (input, executionContext) => {
        try {
          return await execute(input, executionContext);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          return toolErrorResult(error);
        }
      },
    },
    options,
  );
}

function modelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  return (document as Document & { modelContext?: ModelContextLike }).modelContext ?? null;
}

export async function registerWebMcpTools(
  bridge: WebMcpBridge,
  providedContext?: ModelContextLike,
): Promise<(() => void) | null> {
  const context = providedContext ?? modelContext();
  if (!context) return null;

  const controller = new AbortController();
  try {
    await registerReportingTool(
      context,
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
    if (bridge.listGroups) {
      await registerReportingTool(
        context,
        {
          name: "list_groups",
          description: "List source-backed repeating Groups and their safe items.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (_input, context) => {
            if (context?.signal?.aborted) {
              throw new DOMException("Tool execution canceled", "AbortError");
            }
            return textResult(JSON.stringify(bridge.listGroups!()));
          },
        },
        { signal: controller.signal },
      );
    }
    await registerReportingTool(
      context,
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
    await registerReportingTool(
      context,
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
    await registerReportingTool(
      context,
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
                  type: {
                    type: "string",
                    enum: [
                      "text",
                      "link",
                      "asset",
                      "formatting",
                      "sectionVisibility",
                      "moveSection",
                    ],
                  },
                  id: { type: "string", description: "The current Xyle node id." },
                  targetId: { type: "string", description: "The sibling section target id." },
                  before: { type: "boolean", description: "Move before the target when true." },
                  visible: { type: "boolean", description: "Whether the section should be shown." },
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
    await registerReportingTool(
      context,
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
    await registerReportingTool(
      context,
      {
        name: "revert_change",
        description: "Revert one current unsaved Xyle Change to its original state.",
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
          return textResult(JSON.stringify(bridge.revertChange(parseChangeIdInput(input))));
        },
      },
      { signal: controller.signal },
    );
    await registerReportingTool(
      context,
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
    await registerReportingTool(
      context,
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
    await registerReportingTool(
      context,
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
    if (bridge.getSeo) {
      await registerReportingTool(
        context,
        {
          name: "get_seo",
          description: "Read the current page SEO metadata.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (_input, context) => {
            if (context?.signal?.aborted) {
              throw new DOMException("Tool execution canceled", "AbortError");
            }
            return textResult(JSON.stringify(bridge.getSeo!()));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.updateSeo) {
      await registerReportingTool(
        context,
        {
          name: "update_seo",
          description: "Update one safe page SEO metadata field for human review.",
          inputSchema: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: ["title", "description", "canonical", "ogTitle", "ogDescription", "ogImage"],
              },
              value: { type: "string" },
            },
            required: ["field", "value"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted) {
              throw new DOMException("Tool execution canceled", "AbortError");
            }
            const parsed = parseSeoInput(input);
            return textResult(JSON.stringify(bridge.updateSeo!(parsed.field, parsed.value)));
          },
        },
        { signal: controller.signal },
      );
    }
    await registerReportingTool(
      context,
      {
        name: "update_formatting",
        description:
          "Apply safe inline formatting, paragraph/heading styles, or a safe single-item list style to one Xyle text region.",
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
    if (bridge.updateList) {
      await registerReportingTool(
        context,
        {
          name: "update_list",
          description:
            "Group contiguous sibling text blocks into one safe ordered or bulleted list.",
          inputSchema: {
            type: "object",
            properties: {
              ids: {
                type: "array",
                minItems: 1,
                maxItems: 20,
                items: { type: "string" },
                description: "The current contiguous sibling text block ids in document order.",
              },
              format: { type: "string", enum: ["unordered-list", "ordered-list"] },
            },
            required: ["ids", "format"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted) {
              throw new DOMException("Tool execution canceled", "AbortError");
            }
            const parsed = parseListFormattingInput(input);
            return textResult(JSON.stringify(bridge.updateList!(parsed.ids, parsed.format)));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.updateSectionVisibility) {
      await registerReportingTool(
        context,
        {
          name: "set_section_visibility",
          description: "Show or hide one safe Xyle section for human review.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The current Xyle section id." },
              visible: { type: "boolean", description: "Whether the section should be shown." },
            },
            required: ["id", "visible"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseSectionVisibilityInput(input);
            return textResult(
              JSON.stringify(bridge.updateSectionVisibility!(parsed.id, parsed.visible)),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.moveSection) {
      await registerReportingTool(
        context,
        {
          name: "move_section",
          description: "Move one safe Xyle section before or after a sibling section.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The section to move." },
              targetId: { type: "string", description: "The sibling section to move relative to." },
              before: {
                type: "boolean",
                description: "Move before the target when true; after when false.",
              },
            },
            required: ["id", "targetId", "before"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseMoveSectionInput(input);
            return textResult(
              JSON.stringify(bridge.moveSection!(parsed.id, parsed.targetId, parsed.before)),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.duplicateSection) {
      await registerReportingTool(
        context,
        {
          name: "duplicate_section",
          description: "Duplicate one safe Xyle section immediately after itself.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "The safe section to duplicate." } },
            required: ["id"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseIdInput(input, "duplicate_section");
            return textResult(JSON.stringify(bridge.duplicateSection!(parsed)));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.deleteSection) {
      await registerReportingTool(
        context,
        {
          name: "delete_section",
          description: "Delete one safe Xyle area from the draft. A human must publish the change.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "The safe area to delete." } },
            required: ["id"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseIdInput(input, "delete_section");
            return textResult(JSON.stringify(bridge.deleteSection!(parsed)));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.duplicateGroupItem) {
      await registerReportingTool(
        context,
        {
          name: "duplicate_group_item",
          description: "Duplicate one source-backed item in a safe Xyle Group.",
          inputSchema: {
            type: "object",
            properties: {
              groupId: { type: "string", description: "The source-backed Group id." },
              itemId: { type: "string", description: "The source-backed Group item id." },
            },
            required: ["groupId", "itemId"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseGroupItemInput(input);
            return textResult(
              JSON.stringify(bridge.duplicateGroupItem!(parsed.groupId, parsed.itemId)),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.listLayoutOptions) {
      await registerReportingTool(
        context,
        {
          name: "list_layout_options",
          description: "List the safe layout options for one validated area.",
          inputSchema: {
            type: "object",
            properties: { targetId: { type: "string", description: "The safe section id." } },
            required: ["targetId"],
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            return textResult(
              JSON.stringify(bridge.listLayoutOptions!(parseLayoutTargetInput(input))),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.applyLayoutOutcome) {
      await registerReportingTool(
        context,
        {
          name: "change_layout",
          description:
            "Change a validated area to Above and below, Text left, or Image left as one reversible draft action.",
          inputSchema: {
            type: "object",
            properties: {
              targetId: { type: "string", description: "The safe area id." },
              outcome: {
                type: "string",
                enum: ["above-and-below", "text-left", "image-left"],
              },
            },
            required: ["targetId", "outcome"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseLayoutOutcomeInput(input);
            return textResult(
              JSON.stringify(bridge.applyLayoutOutcome!(parsed.targetId, parsed.outcome)),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.moveGroupItem) {
      await registerReportingTool(
        context,
        {
          name: "move_group_item",
          description:
            "Move one source-backed Group item before or after another source-backed item.",
          inputSchema: {
            type: "object",
            properties: {
              groupId: { type: "string", description: "The source-backed Group id." },
              itemId: { type: "string", description: "The source-backed item to move." },
              targetItemId: { type: "string", description: "The source-backed destination item." },
              position: { type: "string", enum: ["before", "after"] },
            },
            required: ["groupId", "itemId", "targetItemId", "position"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseMoveGroupItemInput(input);
            return textResult(
              JSON.stringify(
                bridge.moveGroupItem!(
                  parsed.groupId,
                  parsed.itemId,
                  parsed.targetItemId,
                  parsed.position,
                ),
              ),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.insertParagraph) {
      await registerReportingTool(
        context,
        {
          name: "insert_paragraph",
          description:
            "Split one paragraph or heading at a text offset. The new block is a paragraph.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The editable Xyle text node id." },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Zero-based text offset at which to create the paragraph.",
              },
            },
            required: ["id", "offset"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseTextInsertionInput(input, "insert_paragraph");
            return textResult(JSON.stringify(bridge.insertParagraph!(parsed.id, parsed.offset)));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.insertLineBreak) {
      await registerReportingTool(
        context,
        {
          name: "insert_line_break",
          description: "Insert a line break in one multiline Xyle text block at a text offset.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The editable Xyle text node id." },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Zero-based text offset at which to insert the line break.",
              },
            },
            required: ["id", "offset"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseTextInsertionInput(input, "insert_line_break");
            return textResult(JSON.stringify(bridge.insertLineBreak!(parsed.id, parsed.offset)));
          },
        },
        { signal: controller.signal },
      );
    }
    if (bridge.createLink) {
      await registerReportingTool(
        context,
        {
          name: "create_link",
          description: "Turn a text range into a safe link in one Xyle text block.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The editable Xyle text node id." },
              start: {
                type: "integer",
                minimum: 0,
                description: "Zero-based start offset of the linked text.",
              },
              end: {
                type: "integer",
                minimum: 1,
                description: "Zero-based exclusive end offset of the linked text.",
              },
              href: { type: "string", description: "The safe link destination." },
            },
            required: ["id", "start", "end", "href"],
          },
          annotations: { untrustedContentHint: true },
          execute: async (input, context) => {
            if (context?.signal?.aborted)
              throw new DOMException("Tool execution canceled", "AbortError");
            const parsed = parseCreateLinkInput(input);
            return textResult(
              JSON.stringify(bridge.createLink!(parsed.id, parsed.start, parsed.end, parsed.href)),
            );
          },
        },
        { signal: controller.signal },
      );
    }
    await registerReportingTool(
      context,
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
