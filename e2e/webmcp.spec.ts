import { expect, test, type Page } from "@playwright/test";
import {
  clickOutsideToCommit,
  editNode,
  focusCaret,
  loginAndOpenEditor,
  opsCount,
  setSelection,
} from "./helpers.ts";

type Tool = { name: string };
type ModelContext = {
  getTools(): Promise<Tool[]>;
  executeTool(tool: Tool, input: string): Promise<unknown>;
};

async function invokeTool(page: Page, name: string, input: unknown): Promise<unknown> {
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

  test("applies safe formatting through WebMCP and human editing", async ({
    page,
    browserName,
  }) => {
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
    const heading = content.find(
      (item) => item.type === "text" && item.preview === "Plumbing you can depend on",
    );
    const lede = content.find(
      (item) => item.type === "text" && item.preview.includes("Serving Edmonton"),
    );
    expect(heading?.id).toBeTruthy();
    expect(lede?.id).toBeTruthy();

    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "bold" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "bold" });
    const headingLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${heading!.id}"]`);
    await expect(headingLocator.locator('strong[data-xyle-format="bold"]')).toHaveText(
      heading!.preview,
    );
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      {
        type: "html",
        before: "Plumbing you can depend on",
        after: "<strong>Plumbing you can depend on</strong>",
      },
    ]);
    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "bold" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "bold" });
    await expect(headingLocator.locator('strong[data-xyle-format="bold"]')).toHaveCount(0);
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([]);
    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "bold" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "bold" });
    await expect(invokeTool(page, "list_changes", {})).resolves.toHaveLength(1);

    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect(headingLocator.locator('strong[data-xyle-format="bold"]')).toHaveCount(0);

    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "heading-2" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "heading-2" });
    await expect(headingLocator).toHaveJSProperty("tagName", "H2");
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "formatBlock", before: "heading-1", after: "heading-2" },
    ]);
    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect(headingLocator).toHaveJSProperty("tagName", "H1");

    const servingStart = await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector(`[data-xyle-node="${id}"]`)!;
      const firstText = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      return firstText?.textContent?.indexOf("Serving") ?? -1;
    }, lede!.id);
    expect(servingStart).toBeGreaterThanOrEqual(0);
    await editNode(page, lede!.id);
    await page.evaluate(
      ({ id, start }) => {
        const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
        const element = frame.contentDocument!.querySelector<HTMLElement>(
          `[data-xyle-node="${id}"]`,
        )!;
        const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
        const range = frame.contentDocument!.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + "Serving".length);
        const selection = frame.contentWindow!.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.focus();
      },
      { id: lede!.id, start: servingStart },
    );
    await page.keyboard.insertText("Helping");
    await clickOutsideToCommit(page);

    await editNode(page, lede!.id);
    await setSelection(page, { nodeId: lede!.id, startOffset: 0 });
    const formatTools = page.locator(".xyle-format-tools");
    await expect(formatTools).toBeVisible();
    await formatTools.getByRole("button", { name: "Bold" }).click();
    const ledeLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${lede!.id}"]`);
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"]').first()).toContainText(
      "Helping Edmonton",
    );
    await ledeLocator.click();
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const textNodes = [...element.querySelectorAll("strong")].flatMap((strong) =>
        [...strong.childNodes].filter((node): node is Text => node.nodeType === Node.TEXT_NODE),
      );
      const text = textNodes.at(-1)!;
      const range = frame.contentDocument!.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }, lede!.id);
    await page.keyboard.insertText("!");
    await clickOutsideToCommit(page);
    await expect(ledeLocator).toContainText("wait.!");
    expect(await opsCount(page)).toBe(2);
  });

  test("keeps partial formatting editable after a later text edit", async ({
    page,
    browserName,
  }) => {
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
    const heading = content.find(
      (item) => item.type === "text" && item.preview === "Plumbing you can depend on",
    );
    const lede = content.find(
      (item) => item.type === "text" && item.preview.includes("Serving Edmonton"),
    );
    expect(heading?.id).toBeTruthy();
    expect(lede?.id).toBeTruthy();

    await editNode(page, lede!.id);
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const text = [...element.childNodes].find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.includes("areas"),
      )!;
      const start = text.data.indexOf("areas");
      const range = frame.contentDocument!.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "areas".length);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }, lede!.id);
    const formatTools = page.locator(".xyle-format-tools");
    await expect(formatTools).toBeVisible();
    const placement = await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const frameRect = frame.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const toolRect = document.querySelector(".xyle-format-tools")!.getBoundingClientRect();
      const top = frameRect.top + elementRect.top;
      const bottom = frameRect.top + elementRect.bottom;
      return toolRect.bottom <= top || toolRect.top >= bottom;
    }, lede!.id);
    expect(placement).toBe(true);
    await formatTools.getByRole("button", { name: "Bold" }).click();
    await expect(formatTools.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "data-state",
      "on",
    );

    const ledeLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${lede!.id}"]`);
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"]')).toHaveText("areas");
    await expect(
      page.evaluate(() =>
        document.querySelector("#xyle-preview")
          ? (document.querySelector("#xyle-preview") as HTMLIFrameElement)
              .contentWindow!.getSelection()!
              .toString()
          : "",
      ),
    ).resolves.toBe("areas");
    await clickOutsideToCommit(page);
    await editNode(page, heading!.id);
    await focusCaret(page, heading!.id, "end");
    await page.keyboard.insertText("?");
    await clickOutsideToCommit(page);

    await editNode(page, lede!.id);
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const text = [...element.querySelectorAll("strong")]
        .flatMap((strong) => [...strong.childNodes])
        .find(
          (node): node is Text => node.nodeType === Node.TEXT_NODE && node.textContent === "areas",
        )!;
      const range = frame.contentDocument!.createRange();
      range.selectNodeContents(text);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }, lede!.id);
    await expect(formatTools).toBeVisible();
    await formatTools.getByRole("button", { name: "Bold" }).click();
    await clickOutsideToCommit(page);
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"]')).toHaveCount(0);
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "text", after: "Plumbing you can depend on?" },
    ]);
  });

  test("combines overlapping inline formats", async ({ page, browserName }) => {
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
    const lede = content.find(
      (item) => item.type === "text" && item.preview.includes("Serving Edmonton"),
    );
    expect(lede?.id).toBeTruthy();
    await editNode(page, lede!.id);
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const text = [...element.childNodes].find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.includes("areas"),
      )!;
      const start = text.data.indexOf("areas");
      const range = frame.contentDocument!.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "areas".length);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }, lede!.id);
    const formatTools = page.locator(".xyle-format-tools");
    await expect(formatTools).toBeVisible();
    await formatTools.getByRole("button", { name: "Bold" }).click();
    await formatTools.getByRole("button", { name: "Italic" }).click();
    await formatTools.getByRole("button", { name: "Underline" }).click();
    const ledeLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${lede!.id}"]`);
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"] em u')).toHaveText("areas");
    await clickOutsideToCommit(page);
    await expect(invokeTool(page, "list_changes", {})).resolves.toHaveLength(1);
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

  test("reads and updates safe SEO metadata", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const original = (await invokeTool(page, "get_seo", {})) as {
      title: string;
      description: string;
      canonical: string;
    };
    const nextTitle = `${original.title} — Xyle`;
    await expect(
      invokeTool(page, "update_seo", { field: "title", value: nextTitle }),
    ).resolves.toMatchObject({ field: "title", value: nextTitle, pagePath: "/index.html" });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.title,
        ),
      )
      .toBe(nextTitle);
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "seo", before: original.title, after: nextTitle },
    ]);
    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.title,
        ),
      )
      .toBe(original.title);
    await expect(
      invokeTool(page, "update_seo", { field: "canonical", value: "javascript:bad" }),
    ).rejects.toThrow();
  });

  test("groups several agent edits and undoes the task as one change", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
      capabilities?: { replace?: boolean };
    }>;
    const textNodes = content.filter((item) => item.type === "text");
    const heading = textNodes[0];
    const paragraph = textNodes.find((item) => item.id !== heading?.id);
    const cta = content.find((item) => item.type === "link" && item.preview === "Get a quote");
    const image = content.find(
      (item) => item.type === "image" && item.capabilities?.replace !== false,
    );
    expect(heading?.id).toBeTruthy();
    expect(paragraph?.id).toBeTruthy();
    expect(cta?.id).toBeTruthy();
    expect(image?.id).toBeTruthy();
    const originalImage = (await invokeTool(page, "get_content", { id: image!.id })) as {
      content: string;
      alt?: string;
    };
    const replacementSrc =
      originalImage.content === "/assets/hero-fallback.jpg"
        ? "/assets/hero-wide.webp"
        : "/assets/hero-fallback.jpg";
    const result = (await invokeTool(page, "apply_change_set", {
      label: "Improve the hero",
      changes: [
        { type: "text", id: heading!.id, text: "A clearer heading" },
        { type: "text", id: paragraph!.id, text: "Clear help from a local plumber, day or night." },
        { type: "link", id: cta!.id, text: "Start editing", href: "/contact.html" },
        { type: "asset", id: image!.id, src: replacementSrc, alt: "Updated hero image" },
      ],
    })) as { changeSetId: string; label: string; changes: Array<{ changeSetId?: string }> };
    expect(result.label).toBe("Improve the hero");
    expect(result.changeSetId).toMatch(/^changeset-\d+$/);
    expect(result.changes).toHaveLength(5);
    expect(new Set(result.changes.map((change) => change.changeSetId))).toEqual(
      new Set([result.changeSetId]),
    );
    expect(await opsCount(page)).toBe(5);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${image!.id}"]`),
    ).toHaveAttribute("src", replacementSrc);

    await page.locator("#xyle-changes").click();
    await expect(page.locator("#xyle-changes-drawer")).toContainText("Improve the hero");
    await expect(page.locator(".xyle-change-set-undo")).toBeVisible();

    await expect(
      invokeTool(page, "undo_change_set", { changeSetId: result.changeSetId }),
    ).resolves.toEqual({ changeSetId: result.changeSetId, undone: true });
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${heading!.id}"]`),
    ).toHaveText(heading!.preview);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${paragraph!.id}"]`),
    ).toHaveText(paragraph!.preview);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${cta!.id}"]`),
    ).toHaveText(cta!.preview);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${image!.id}"]`),
    ).toHaveAttribute("src", originalImage.content);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${image!.id}"]`),
    ).toHaveAttribute("alt", originalImage.alt ?? "");
    expect(await opsCount(page)).toBe(0);
    await expect(
      invokeTool(page, "apply_change_set", {
        label: "Should fail atomically",
        changes: [
          { type: "text", id: heading!.id, text: "Not applied" },
          { type: "text", id: "not-a-current-node", text: "Also not applied" },
        ],
      }),
    ).rejects.toThrow();
    expect(await opsCount(page)).toBe(0);
    await expect(invokeTool(page, "get_content", { id: heading!.id })).resolves.toMatchObject({
      content: heading!.preview,
    });
  });

  test("groups contiguous text blocks into one list", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/about.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const blocks = [
      content.find((item) => item.preview.includes("The first Riverbend jobs")),
      content.find((item) => item.preview.includes("We keep appointments realistic")),
    ];
    expect(blocks.every((block) => block?.type === "text")).toBe(true);
    const ids = blocks.map((block) => block!.id);
    await expect(
      invokeTool(page, "update_list", { ids, format: "unordered-list" }),
    ).resolves.toMatchObject({ ids, format: "unordered-list", pagePath: "/about.html" });
    const first = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${ids[0]}"]`);
    await expect(first).toHaveJSProperty("tagName", "LI");
    await expect(first.locator("..")).toHaveJSProperty("tagName", "UL");
    await expect(first.locator("..").locator(":scope > li")).toHaveCount(2);
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "toggleList", before: "paragraphs", after: "ul" },
    ]);
    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect(first).toHaveJSProperty("tagName", "P");
    expect(await opsCount(page)).toBe(0);
  });

  test("formats a safely mapped text block as a list", async ({ page, browserName }) => {
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
    const paragraph = content.find(
      (item) => item.type === "text" && item.preview.includes("Serving Edmonton"),
    );
    expect(paragraph?.id).toBeTruthy();
    const paragraphLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${paragraph!.id}"]`);

    await expect(
      invokeTool(page, "update_formatting", {
        id: paragraph!.id,
        format: "unordered-list",
      }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "unordered-list" });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "LI");
    await expect(paragraphLocator.locator("..")).toHaveJSProperty("tagName", "UL");
    await expect(paragraphLocator).toHaveText(paragraph!.preview);
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "toggleList", before: "paragraphs", after: "ul" },
    ]);
    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "unordered-list" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "unordered-list" });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "P");
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([]);
    expect(await opsCount(page)).toBe(0);

    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "ordered-list" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "ordered-list" });
    await expect(paragraphLocator.locator("..")).toHaveJSProperty("tagName", "OL");
    await expect(invokeTool(page, "undo_change", { changeId: "change-1" })).resolves.toMatchObject({
      changeId: "change-1",
      undone: true,
    });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "P");
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
