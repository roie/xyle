export interface EditableContent {
  id: string;
  type: "text" | "link";
  preview: string;
}

export interface ContentResult {
  id: string;
  type: "text" | "link";
  content: string;
}

export interface TextUpdateResult {
  id: string;
  pagePath: string;
  text: string;
}

export interface WebMcpBridge {
  listEditableContent(): EditableContent[];
  getContent(id: string): ContentResult;
  updateText(id: string, text: string): TextUpdateResult;
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

function parseTextUpdateInput(value: unknown): { id: string; text: string } {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    throw new Error("update_text requires string fields id and text");
  }
  return { id: value.id, text: value.text };
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
