import { describe, expect, test } from "vitest";
import { registerWebMcpTools } from "../src/webmcp.ts";

describe("WebMCP tools", () => {
  test("registers the first editor tools and invokes them through the bridge", async () => {
    const tools: Array<{
      name: string;
      execute: (input: unknown, context: { signal: AbortSignal }) => unknown;
    }> = [];
    const context = {
      registerTool: async (tool: (typeof tools)[number]): Promise<void> => {
        tools.push(tool);
      },
    };
    const bridge = {
      listEditableContent: () => [{ id: "n1", type: "text" as const, preview: "Xyle" }],
      getContent: (id: string) => ({ id, type: "text" as const, content: "Xyle" }),
      listChanges: () => [
        {
          changeId: "change-1",
          elementId: "n1",
          type: "text" as const,
          before: "Xyle",
          after: "Hello",
        },
      ],
      undoChange: (changeId: string) => ({ changeId, undone: true as const }),
      updateText: (id: string, text: string) => ({ id, pagePath: "/index.html", text }),
      updateLink: (id: string, text?: string, href?: string) => ({
        id,
        pagePath: "/index.html",
        text: text ?? "Xyle",
        href: href ?? "/",
      }),
    };

    const unregister = await registerWebMcpTools(bridge, context);
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_editable_content",
      "get_content",
      "list_changes",
      "undo_change",
      "update_link",
      "update_text",
    ]);

    const signal = new AbortController().signal;
    await expect(tools[0]!.execute({}, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.listEditableContent()) }],
    });
    await expect(tools[1]!.execute({ id: "n1" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.getContent("n1")) }],
    });
    await expect(tools[2]!.execute({}, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.listChanges()) }],
    });
    await expect(tools[3]!.execute({ changeId: "change-1" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.undoChange("change-1")) }],
    });
    await expect(tools[4]!.execute({ id: "n1", href: "/about.html" }, { signal })).resolves.toEqual(
      {
        content: [
          {
            type: "text",
            text: JSON.stringify(bridge.updateLink("n1", undefined, "/about.html")),
          },
        ],
      },
    );
    await expect(tools[5]!.execute({ id: "n1", text: "Hello" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.updateText("n1", "Hello")) }],
    });

    unregister?.();
  });

  test("does not register when the browser has no model context", async () => {
    await expect(
      registerWebMcpTools({
        listEditableContent: () => [],
        getContent: (id) => ({ id, type: "text", content: "" }),
        listChanges: () => [],
        undoChange: (changeId) => ({ changeId, undone: true }),
        updateText: (id, text) => ({ id, pagePath: "/index.html", text }),
        updateLink: (id, text, href) => ({
          id,
          pagePath: "/index.html",
          text: text ?? "",
          href: href ?? "/",
        }),
      }),
    ).resolves.toBeNull();
  });
});
