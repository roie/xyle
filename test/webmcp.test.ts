import { describe, expect, test } from "vitest";
import { registerWebMcpTools, type ChangeSetOperation, type Formatting } from "../src/webmcp.ts";

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
    let appliedChangeSet: { label: string; changes: ChangeSetOperation[] } | undefined;
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
      revertChange: (changeId: string) => ({ changeId, undone: true as const }),
      applyChangeSet: (label: string, changes: ChangeSetOperation[]) => {
        appliedChangeSet = { label, changes };
        return { changeSetId: "changeset-1", label, changes: [] };
      },
      undoChangeSet: (changeSetId: string) => ({ changeSetId, undone: true as const }),
      replaceAsset: (id: string, src: string, alt?: string) => ({
        id,
        pagePath: "/index.html",
        src,
        alt: alt ?? "",
      }),
      updateMedia: (
        id: string,
        patch: { src?: string; alt?: string; fit?: "cover" | "contain" },
      ) => ({
        id,
        pagePath: "/index.html",
        src: patch.src ?? "/images/old.jpg",
        alt: patch.alt ?? "",
      }),
      updateFormatting: (id: string, format: Formatting) => ({
        id,
        pagePath: "/index.html",
        format,
      }),
      updateSectionVisibility: (id: string, visible: boolean) => ({ id, visible }),
      moveSection: (id: string, targetId: string, before: boolean) => ({ id, targetId, before }),
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
      "apply_change_set",
      "undo_change_set",
      "revert_change",
      "update_link",
      "replace_asset",
      "update_media",
      "update_formatting",
      "set_section_visibility",
      "move_section",
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
    const expectedChanges = [
      { type: "text", id: "n1", text: "Hello" },
      { type: "link", id: "n2", href: "/about.html" },
      { type: "asset", id: "n3", src: "/images/new.jpg", alt: "New image" },
      { type: "formatting", id: "n4", format: "heading-2" },
      { type: "sectionVisibility", id: "s1", visible: false },
      { type: "moveSection", id: "s2", targetId: "s3", before: true },
    ] satisfies ChangeSetOperation[];
    await expect(
      tools[3]!.execute(
        {
          label: "  Hero rewrite  ",
          changes: [
            { type: "text", id: "n1", text: "Hello", ignored: "field" },
            { type: "link", id: "n2", href: "/about.html" },
            { type: "asset", id: "n3", src: "/images/new.jpg", alt: "New image" },
            { type: "formatting", id: "n4", format: "heading-2" },
            { type: "sectionVisibility", id: "s1", visible: false },
            { type: "moveSection", id: "s2", targetId: "s3", before: true },
          ],
        },
        { signal },
      ),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ changeSetId: "changeset-1", label: "Hero rewrite", changes: [] }),
        },
      ],
    });
    expect(appliedChangeSet).toEqual({ label: "Hero rewrite", changes: expectedChanges });
    await expect(tools[4]!.execute({ changeSetId: "changeset-1" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.undoChangeSet("changeset-1")) }],
    });
    await expect(tools[5]!.execute({ changeId: "change-1" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.revertChange("change-1")) }],
    });
    await expect(tools[6]!.execute({ id: "n1", href: "/about.html" }, { signal })).resolves.toEqual(
      {
        content: [
          {
            type: "text",
            text: JSON.stringify(bridge.updateLink("n1", undefined, "/about.html")),
          },
        ],
      },
    );
    await expect(
      tools[7]!.execute({ id: "n1", src: "/images/new.jpg", alt: "A new image" }, { signal }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(bridge.replaceAsset("n1", "/images/new.jpg", "A new image")),
        },
      ],
    });
    await expect(
      tools[8]!.execute({ id: "n1", src: "/images/crop.jpg", fit: "cover" }, { signal }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(bridge.updateMedia("n1", { src: "/images/crop.jpg", fit: "cover" })),
        },
      ],
    });
    await expect(tools[9]!.execute({ id: "n1", format: "bold" }, { signal })).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(bridge.updateFormatting("n1", "bold")),
        },
      ],
    });
    await expect(tools[10]!.execute({ id: "s1", visible: false }, { signal })).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(bridge.updateSectionVisibility!("s1", false)),
        },
      ],
    });
    await expect(
      tools[11]!.execute({ id: "s2", targetId: "s1", before: true }, { signal }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(bridge.moveSection!("s2", "s1", true)),
        },
      ],
    });
    await expect(tools[12]!.execute({ id: "n1", text: "Hello" }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify(bridge.updateText("n1", "Hello")) }],
    });
    await expect(
      tools[3]!.execute(
        { label: " ", changes: [{ type: "text", id: "n1", text: "x" }] },
        { signal },
      ),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "apply_change_set label must be 1 to 100 characters" }),
        },
      ],
    });

    unregister?.();
  });

  test("does not register when the browser has no model context", async () => {
    await expect(
      registerWebMcpTools({
        listEditableContent: () => [],
        getContent: (id) => ({ id, type: "text", content: "" }),
        listChanges: () => [],
        revertChange: (changeId: string) => ({ changeId, undone: true }),
        applyChangeSet: (label, _changes) => ({ changeSetId: "changeset-1", label, changes: [] }),
        undoChangeSet: (changeSetId) => ({ changeSetId, undone: true }),
        replaceAsset: (id, src, alt) => ({ id, pagePath: "/index.html", src, alt: alt ?? "" }),
        updateMedia: (id, patch) => ({
          id,
          pagePath: "/index.html",
          src: patch.src ?? "",
          alt: patch.alt ?? "",
        }),
        updateFormatting: (id, format) => ({ id, pagePath: "/index.html", format }),
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
