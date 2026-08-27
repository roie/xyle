import { expect, test, type Page } from "@playwright/test";
import {
  clickOutsideToCommit,
  editNode,
  loginAndOpenEditor,
  opsCount,
  setSelection,
} from "./helpers.ts";

type Tool = { name: string };
type ModelContext = {
  getTools(): Promise<Tool[]>;
  executeTool(tool: Tool, input: string): Promise<unknown>;
};

async function invokeTool(
  page: Page,
  name: string,
  input: Record<string, string>,
): Promise<unknown> {
  return page.evaluate(
    async ({ name, input }) => {
      const context = (document as Document & { modelContext?: ModelContext }).modelContext!;
      const tools = await context.getTools();
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} was not registered`);
      const raw = await context.executeTool(tool, JSON.stringify(input));
      const envelope = JSON.parse(String(raw)) as { content: Array<{ text: string }> };
      return JSON.parse(envelope.content[0]!.text);
    },
    { name, input },
  );
}

test.describe("WebMCP editor tools", () => {
  test("discovers and updates an editable heading through Xyle", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const discovered = await page.evaluate(async () => {
      const context = (document as Document & { modelContext?: ModelContext }).modelContext;
      if (!context) return null;
      const tools = await context.getTools();
      const listTool = tools.find((tool) => tool.name === "list_editable_content");
      if (!listTool) throw new Error("list_editable_content was not registered");
      const listResult = await context.executeTool(listTool, "{}");
      const listEnvelope = JSON.parse(String(listResult)) as {
        content: Array<{ text: string }>;
      };
      return {
        tools: tools.map((tool) => tool.name),
        content: JSON.parse(listEnvelope.content[0]!.text) as Array<{
          id: string;
          type: string;
          preview: string;
        }>,
      };
    });

    if (!discovered) {
      test.skip(true, "This Chromium build does not expose document.modelContext");
      return;
    }
    expect(discovered.tools).toContain("get_content");
    expect(discovered.tools).toContain("list_changes");
    expect(discovered.tools).toContain("undo_change");
    expect(discovered.tools).toContain("update_text");
    const heading = discovered.content.find((item) => item.type === "text");
    expect(heading?.id).toBeTruthy();
    expect(heading?.preview).toBeTruthy();

    const originalText = heading!.preview;
    const humanText = "Human edit before the agent";
    await editNode(page, heading!.id);
    await setSelection(page, { nodeId: heading!.id, selectAll: true });
    await page.keyboard.insertText(humanText);
    await clickOutsideToCommit(page);

    await expect(invokeTool(page, "get_content", { id: heading!.id })).resolves.toMatchObject({
      id: heading!.id,
      content: humanText,
    });

    const updatedText = "Hello from WebMCP";
    await expect(
      invokeTool(page, "update_text", { id: heading!.id, text: updatedText }),
    ).resolves.toMatchObject({
      id: heading!.id,
      text: updatedText,
    });
    await expect(invokeTool(page, "get_content", { id: heading!.id })).resolves.toMatchObject({
      id: heading!.id,
      content: updatedText,
    });
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([
      {
        changeId: "change-1",
        elementId: heading!.id,
        type: "text",
        before: originalText,
        after: updatedText,
      },
    ]);

    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${heading!.id}"]`),
    ).toHaveText(updatedText);
    expect(await opsCount(page)).toBe(1);
    await expect(page.locator("#xyle-count")).toHaveText("1");
    await page.locator("#xyle-changes").click();
    await expect(page.locator("#xyle-changes-drawer")).toBeVisible();

    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${heading!.id}"]`),
    ).toHaveText(originalText);
    expect(await opsCount(page)).toBe(0);
  });

  test("combines human and agent edits before human publishing", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const heading = content.find((item) => item.type === "text");
    const paragraph = content.find(
      (item) => item.type === "text" && item.preview.includes("Emergency calls"),
    );
    const cta = content.find((item) => item.type === "link" && item.preview === "Get a quote");
    expect(heading?.id).toBeTruthy();
    expect(paragraph?.id).toBeTruthy();
    expect(cta?.id).toBeTruthy();

    const humanHeading = "A heading edited by a human";
    await editNode(page, heading!.id);
    await setSelection(page, { nodeId: heading!.id, selectAll: true });
    await page.keyboard.insertText(humanHeading);
    await clickOutsideToCommit(page);

    const agentParagraph = "Clear help from a local plumber, day or night.";
    await expect(
      invokeTool(page, "update_text", { id: paragraph!.id, text: agentParagraph }),
    ).resolves.toMatchObject({ id: paragraph!.id, text: agentParagraph });
    await expect(
      invokeTool(page, "update_link", { id: cta!.id, text: "Start editing" }),
    ).resolves.toMatchObject({ id: cta!.id, text: "Start editing" });

    const changes = (await invokeTool(page, "list_changes", {})) as Array<{
      changeId: string;
      elementId: string;
      after: string;
    }>;
    const ctaChange = changes.find((change) => change.elementId === cta!.id);
    expect(ctaChange?.changeId).toBeTruthy();
    expect(ctaChange?.after).toBe("Start editing");

    await invokeTool(page, "undo_change", { changeId: ctaChange!.changeId });
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${cta!.id}"]`),
    ).toHaveText("Get a quote");

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const published = await (await page.request.get("/index.html")).text();
    expect(published).toContain(humanHeading);
    expect(published).toContain(agentParagraph);
    expect(published).toContain("Get a quote");
    expect(published).not.toContain("Start editing");
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("updates a link and rejects unsafe destinations", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const link = content.find((item) => item.type === "link" && item.preview === "About");
    expect(link?.id).toBeTruthy();

    const linkLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${link!.id}"]`);
    const originalHref = await linkLocator.getAttribute("href");
    const result = await invokeTool(page, "update_link", {
      id: link!.id,
      text: "Company",
      href: "/contact.html",
    });
    expect(result).toMatchObject({
      id: link!.id,
      text: "Company",
      href: "/contact.html",
    });
    await expect(linkLocator).toHaveText("Company");
    await expect(linkLocator).toHaveAttribute("href", "/contact.html");

    const unsafeRejected = await page.evaluate(async (id) => {
      const context = (document as Document & { modelContext?: ModelContext }).modelContext!;
      const tools = await context.getTools();
      const tool = tools.find((candidate) => candidate.name === "update_link");
      if (!tool) throw new Error("update_link was not registered");
      try {
        await context.executeTool(tool, JSON.stringify({ id, href: "javascript:alert(1)" }));
        return false;
      } catch {
        return true;
      }
    }, link!.id);
    expect(unsafeRejected).toBe(true);
    await expect(linkLocator).toHaveAttribute("href", "/contact.html");
    expect(originalHref).toBe("/about.html");
  });
});
