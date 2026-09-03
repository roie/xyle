import { expect, test, type Page } from "@playwright/test";
import {
  clickOutsideToCommit,
  currentOps,
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

async function firstChangeId(page: Page, type?: string): Promise<string> {
  const changes = (await invokeTool(page, "list_changes", {})) as Array<{
    changeId: string;
    type: string;
  }>;
  const change = changes.find((candidate) => !type || candidate.type === type);
  if (!change) throw new Error("No matching Xyle Change");
  return change.changeId;
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
    expect(discovered.tools).toContain("revert_change");
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
    const headingChangeId = await firstChangeId(page);
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([
      {
        changeId: headingChangeId,
        elementId: heading!.id,
        type: "text",
        before: expect.stringContaining(originalText),
        after: expect.stringContaining(updatedText),
      },
    ]);

    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${heading!.id}"]`),
    ).toHaveText(updatedText);
    expect(await opsCount(page)).toBe(1);
    await expect(page.locator("#xyle-count")).toHaveText("1");
    await page.locator("#xyle-changes").click();
    await expect(page.locator("#xyle-changes-drawer")).toBeVisible();

    await expect(
      invokeTool(page, "revert_change", { changeId: headingChangeId }),
    ).resolves.toMatchObject({
      changeId: headingChangeId,
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
      (item) => item.type === "text" && item.preview === "Edit your static site visually",
    );
    const lede = content.find(
      (item) => item.type === "text" && item.preview.includes("Change this page in place"),
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
        before: expect.stringContaining("Edit your static site visually"),
        after: expect.stringContaining("<strong>Edit your static site visually</strong>"),
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
    const boldChangeId = await firstChangeId(page);
    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "heading-2" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "heading-2" });
    await expect(headingLocator).toHaveJSProperty("tagName", "H2");
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      {
        changeId: boldChangeId,
        type: "html",
        after: expect.stringContaining("<h2"),
      },
    ]);
    await page.keyboard.press("Control+z");
    await expect(headingLocator).toHaveJSProperty("tagName", "H1");
    const restoredFormattingOps = await currentOps(page);
    expect(restoredFormattingOps).toEqual([
      expect.objectContaining({
        op: expect.objectContaining({
          type: "html",
          value: expect.stringContaining("<strong"),
        }),
      }),
    ]);
    await expect(headingLocator.locator("strong")).toHaveText(heading!.preview);
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      { type: "html", after: expect.stringContaining("<h1") },
    ]);

    const richChangeId = await firstChangeId(page);
    await expect(
      invokeTool(page, "revert_change", { changeId: richChangeId }),
    ).resolves.toMatchObject({
      changeId: richChangeId,
      undone: true,
    });
    await expect(headingLocator.locator('strong[data-xyle-format="bold"]')).toHaveCount(0);

    await expect(
      invokeTool(page, "update_formatting", { id: heading!.id, format: "heading-2" }),
    ).resolves.toMatchObject({ id: heading!.id, format: "heading-2" });
    await expect(headingLocator).toHaveJSProperty("tagName", "H2");
    await expect(invokeTool(page, "list_changes", {})).resolves.toMatchObject([
      {
        type: "html",
        before: expect.stringContaining("<h1"),
        after: expect.stringContaining("<h2"),
      },
    ]);
    const headingChangeId = await firstChangeId(page);
    await expect(
      invokeTool(page, "revert_change", { changeId: headingChangeId }),
    ).resolves.toMatchObject({
      changeId: headingChangeId,
      undone: true,
    });
    await expect(headingLocator).toHaveJSProperty("tagName", "H1");

    const changeStart = await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector(`[data-xyle-node="${id}"]`)!;
      const firstText = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      return firstText?.textContent?.indexOf("Change") ?? -1;
    }, lede!.id);
    expect(changeStart).toBeGreaterThanOrEqual(0);
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
        range.setEnd(text, start + "Change".length);
        const selection = frame.contentWindow!.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.focus();
      },
      { id: lede!.id, start: changeStart },
    );
    await page.keyboard.insertText("Try");
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
      "Try this page in place",
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
    await expect(ledeLocator).toContainText("files.!");
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
      (item) => item.type === "text" && item.preview === "Edit your static site visually",
    );
    const lede = content.find(
      (item) => item.type === "text" && item.preview.includes("Change this page in place"),
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
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.includes("page"),
      )!;
      const start = text.data.indexOf("page");
      const range = frame.contentDocument!.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "page".length);
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
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"]')).toHaveText("page");
    await expect(
      page.evaluate(() =>
        document.querySelector("#xyle-preview")
          ? (document.querySelector("#xyle-preview") as HTMLIFrameElement)
              .contentWindow!.getSelection()!
              .toString()
          : "",
      ),
    ).resolves.toBe("page");
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
          (node): node is Text => node.nodeType === Node.TEXT_NODE && node.textContent === "page",
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
      { type: "text", after: expect.stringContaining("Edit your static site visually?") },
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
      (item) => item.type === "text" && item.preview.includes("Change this page in place"),
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
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.includes("page"),
      )!;
      const start = text.data.indexOf("page");
      const range = frame.contentDocument!.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "page".length);
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
    await expect(ledeLocator.locator('strong[data-xyle-format="bold"] em u')).toHaveText("page");
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
      (item) => item.type === "text" && item.preview.includes("Select visible content"),
    );
    const cta = content.find((item) => item.type === "link" && item.preview === "Try another page");
    expect(heading?.id).toBeTruthy();
    expect(paragraph?.id).toBeTruthy();
    expect(cta?.id).toBeTruthy();

    const humanHeading = "A heading edited by a human";
    await editNode(page, heading!.id);
    await setSelection(page, { nodeId: heading!.id, selectAll: true });
    await page.keyboard.insertText(humanHeading);
    await clickOutsideToCommit(page);

    const agentParagraph = "People and agents share one safe editing path.";
    await expect(
      invokeTool(page, "update_text", { id: paragraph!.id, text: agentParagraph }),
    ).resolves.toMatchObject({ id: paragraph!.id, text: agentParagraph });
    await expect(
      invokeTool(page, "update_link", { id: cta!.id, text: "Start editing" }),
    ).resolves.toMatchObject({ id: cta!.id, text: "Start editing" });

    const changes = (await invokeTool(page, "list_changes", {})) as Array<{
      changeId: string;
      elementId: string;
      type: string;
      after: string;
    }>;
    const ctaChange = changes.find((change) => change.elementId === cta!.id);
    expect(ctaChange?.changeId).toBeTruthy();
    expect(ctaChange?.type).toBe("text");
    expect(ctaChange?.after).toContain("Start editing");

    await invokeTool(page, "revert_change", { changeId: ctaChange!.changeId });
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${cta!.id}"]`),
    ).toHaveText("Try another page");

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const published = await (await page.request.get("/index.html")).text();
    expect(published).toContain(humanHeading);
    expect(published).toContain(agentParagraph);
    expect(published).toContain("Try another page");
    expect(published).not.toContain("Start editing");
    await expect(page.locator("#xyle-dirty")).toBeHidden();

    await page.goto("/index.html");
    await expect(page.getByText(humanHeading, { exact: true })).toBeVisible();
    await expect(page.getByText(agentParagraph)).toBeVisible();
    await expect(page.getByRole("link", { name: "Try another page" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start editing" })).toHaveCount(0);
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
    const seoChangeId = await firstChangeId(page, "seo");
    await expect(
      invokeTool(page, "revert_change", { changeId: seoChangeId }),
    ).resolves.toMatchObject({
      changeId: seoChangeId,
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
    ).resolves.toEqual({ error: "Unsafe SEO URL rejected for canonical" });
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
    const cta = content.find((item) => item.type === "link" && item.preview === "Try another page");
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
        { type: "text", id: paragraph!.id, text: "People and agents share one safe editing path." },
        { type: "link", id: cta!.id, text: "Start editing", href: "/contact.html" },
        { type: "asset", id: image!.id, src: replacementSrc, alt: "Updated hero image" },
      ],
    })) as { changeSetId: string; label: string; changes: Array<{ changeSetId?: string }> };
    expect(result.label).toBe("Improve the hero");
    expect(result.changeSetId).toMatch(/^changeset-\d+$/);
    expect(result.changes).toHaveLength(4);
    expect(new Set(result.changes.map((change) => change.changeSetId))).toEqual(
      new Set([result.changeSetId]),
    );
    expect(await opsCount(page)).toBe(4);
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
    ).resolves.toEqual({
      error: "Unknown or unavailable Xyle node not-a-current-node",
    });
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
      content.find((item) => item.preview.includes("The first Xyle edits")),
      content.find((item) => item.preview.includes("Each pending change stays visible")),
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
      {
        type: "html",
        before: expect.stringContaining("<p"),
        after: expect.stringContaining("<ul>"),
      },
    ]);
    const groupedListChangeId = await firstChangeId(page, "html");
    await expect(
      invokeTool(page, "revert_change", { changeId: groupedListChangeId }),
    ).resolves.toMatchObject({
      changeId: groupedListChangeId,
      undone: true,
    });
    await expect(first).toHaveJSProperty("tagName", "P");
    expect(await opsCount(page)).toBe(0);
  });

  test("rejects a WebMCP list selection across unsupported sibling content", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const before = content.find((item) => item.preview === "Before divider");
    const after = content.find((item) => item.preview === "After divider");
    const beforeOrphan = content.find((item) => item.preview === "Before orphan text");
    const afterOrphan = content.find((item) => item.preview === "After orphan text");
    const unsafeListItem = content.find((item) => item.preview === "Unsafe list item");
    expect(before?.id).toBeTruthy();
    expect(after?.id).toBeTruthy();
    expect(beforeOrphan?.id).toBeTruthy();
    expect(afterOrphan?.id).toBeTruthy();
    expect(unsafeListItem?.id).toBeTruthy();

    await expect(
      invokeTool(page, "update_list", {
        ids: [before!.id, after!.id],
        format: "unordered-list",
      }),
    ).resolves.toEqual({ error: "Selected blocks must share one authored formatting region" });
    await expect(
      invokeTool(page, "update_list", {
        ids: [beforeOrphan!.id, afterOrphan!.id],
        format: "unordered-list",
      }),
    ).resolves.toEqual({ error: "Selected blocks must share one authored formatting region" });
    await expect(
      invokeTool(page, "update_formatting", {
        id: unsafeListItem!.id,
        format: "heading-2",
      }),
    ).resolves.toEqual({ error: "List contains unsupported non-item content" });
    expect(await opsCount(page)).toBe(0);
    const preview = page.frameLocator("#xyle-preview");
    await expect(preview.locator(`[data-xyle-node="${before!.id}"]`)).toHaveJSProperty(
      "tagName",
      "P",
    );
    await expect(preview.getByRole("img", { name: "Divider" })).toBeVisible();
    await expect(preview.locator(`[data-xyle-node="${after!.id}"]`)).toHaveJSProperty(
      "tagName",
      "P",
    );
  });

  test("reconciles authored list formatting in one WebMCP change set", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const listItem = content.find((item) => item.preview === "Beta item");
    const paragraph = content.find((item) => item.preview === "Plain block");
    expect(listItem?.id).toBeTruthy();
    expect(paragraph?.id).toBeTruthy();
    const preview = page.frameLocator("#xyle-preview");
    const listItemLocator = preview.locator(`[data-xyle-node="${listItem!.id}"]`);
    const paragraphLocator = preview.locator(`[data-xyle-node="${paragraph!.id}"]`);

    await expect(
      invokeTool(page, "update_formatting", { id: listItem!.id, format: "heading-2" }),
    ).resolves.toMatchObject({ id: listItem!.id, format: "heading-2" });
    await expect(listItemLocator).toHaveJSProperty("tagName", "H2");
    await expect(
      invokeTool(page, "update_formatting", { id: listItem!.id, format: "unordered-list" }),
    ).resolves.toMatchObject({ id: listItem!.id, format: "unordered-list" });
    await expect(listItemLocator).toHaveJSProperty("tagName", "LI");
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([]);

    const result = (await invokeTool(page, "apply_change_set", {
      label: "Reshape two blocks",
      changes: [
        { type: "formatting", id: listItem!.id, format: "ordered-list" },
        { type: "formatting", id: paragraph!.id, format: "heading-4" },
      ],
    })) as { changeSetId: string; changes: Array<{ changeSetId?: string }> };
    expect(result.changes).toHaveLength(2);
    await expect(listItemLocator.locator("..")).toHaveJSProperty("tagName", "OL");
    await expect(paragraphLocator).toHaveJSProperty("tagName", "H4");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual([
      "setBlockFormat",
      "setBlockFormat",
    ]);

    await page.keyboard.press("Control+z");
    await expect(listItemLocator.locator("..")).toHaveJSProperty("tagName", "UL");
    await expect(paragraphLocator).toHaveJSProperty("tagName", "P");
    expect(await opsCount(page)).toBe(0);

    await page.keyboard.press("Control+Shift+z");
    await expect(listItemLocator.locator("..")).toHaveJSProperty("tagName", "OL");
    await expect(paragraphLocator).toHaveJSProperty("tagName", "H4");
    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/formatting-matrix.html");
    await expect(page.locator("ol.authored-list > li")).toHaveText("Beta item");
    await expect(page.getByRole("heading", { level: 4, name: "Plain block" })).toBeVisible();
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
      (item) => item.type === "text" && item.preview.includes("Change this page in place"),
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
      {
        type: "html",
        before: expect.stringContaining("<p"),
        after: expect.stringContaining("<ul>"),
      },
    ]);
    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "unordered-list" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "unordered-list" });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "LI");
    expect(await opsCount(page)).toBe(1);

    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "paragraph" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "paragraph" });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "P");
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual([]);
    expect(await opsCount(page)).toBe(0);

    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "ordered-list" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "ordered-list" });
    await expect(paragraphLocator.locator("..")).toHaveJSProperty("tagName", "OL");
    await expect(
      invokeTool(page, "update_formatting", { id: paragraph!.id, format: "heading-3" }),
    ).resolves.toMatchObject({ id: paragraph!.id, format: "heading-3" });
    await expect(paragraphLocator).toHaveJSProperty("tagName", "H3");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["setBlockFormat"]);
    const headingChangeId = await firstChangeId(page, "html");
    await expect(
      invokeTool(page, "revert_change", { changeId: headingChangeId }),
    ).resolves.toMatchObject({
      changeId: headingChangeId,
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

    await expect(
      invokeTool(page, "update_link", { id: link!.id, href: "google.com/search?q=xyle" }),
    ).resolves.toMatchObject({ href: "https://google.com/search?q=xyle" });
    await expect(linkLocator).toHaveAttribute("href", "https://google.com/search?q=xyle");

    await expect(
      invokeTool(page, "update_link", {
        id: link!.id,
        href: "javascript:alert(1)",
      }),
    ).resolves.toEqual({ error: "Unsafe link destination rejected" });
    await expect(linkLocator).toHaveAttribute("href", "https://google.com/search?q=xyle");
    expect(originalHref).toBe("/about.html");
  });

  test("hides and reorders safe sections through WebMCP", async ({ page, browserName }) => {
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
    const sections = content.filter((item) => item.type === "section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const [first, second] = sections;
    const firstLocator = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${first!.id}"]`);
    const sectionOrder = () =>
      page.evaluate(() => {
        const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
        return [...doc.querySelectorAll("main > section")].map((section) =>
          section.getAttribute("data-xyle-node"),
        );
      });
    const originalOrder = await sectionOrder();

    await invokeTool(page, "set_section_visibility", { id: first!.id, visible: false });
    await expect(firstLocator).toHaveJSProperty("hidden", true);
    const hiddenChange = (await invokeTool(page, "list_changes", {})) as Array<{
      changeId: string;
      type: string;
    }>;
    const hiddenEntry = hiddenChange.find((change) => change.type === "sectionVisibility");
    expect(hiddenEntry?.changeId).toBeTruthy();
    await invokeTool(page, "revert_change", { changeId: hiddenEntry!.changeId });
    await expect(firstLocator).toHaveJSProperty("hidden", false);

    await invokeTool(page, "move_section", { id: second!.id, targetId: first!.id, before: true });
    await expect.poll(sectionOrder).toEqual([second!.id, first!.id, ...originalOrder.slice(2)]);
    const moveChanges = (await invokeTool(page, "list_changes", {})) as Array<{
      changeId: string;
      type: string;
    }>;
    const moveEntry = moveChanges.find((change) => change.type === "moveSection");
    expect(moveEntry?.changeId).toBeTruthy();
    await invokeTool(page, "revert_change", { changeId: moveEntry!.changeId });
    await expect.poll(sectionOrder).toEqual(originalOrder);
  });

  test("duplicates a safe section and edits its created descendant through WebMCP", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/index.html");
    const groups = await invokeTool(page, "list_groups", {});
    expect(Array.isArray(groups)).toBe(true);
    const content = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
    }>;
    const sourceSection = content.find((item) => item.type === "section");
    expect(sourceSection?.id).toBeTruthy();
    const duplicate = (await invokeTool(page, "duplicate_section", { id: sourceSection!.id })) as {
      id: string;
      sourceId: string;
    };
    expect(duplicate.sourceId).toBe(sourceSection!.id);

    const createdText = await page.evaluate((createdId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const root = doc.querySelector(`[data-xyle-node="${createdId}"]`);
      return root
        ? [...root.querySelectorAll("[data-xyle-node]")]
            .map((element) => ({
              id: element.getAttribute("data-xyle-node"),
              tag: element.tagName,
            }))
            .find((element) => element.id !== createdId && /^(H1|H2|H3|P)$/.test(element.tag))
        : undefined;
    }, duplicate.id);
    expect(createdText?.id).toBeTruthy();
    await expect(
      invokeTool(page, "update_text", { id: createdText!.id, text: "WebMCP duplicate edit" }),
    ).resolves.toMatchObject({ id: createdText!.id, text: "WebMCP duplicate edit" });

    const changes = (await invokeTool(page, "list_changes", {})) as Array<{ type: string }>;
    expect(changes.some((change) => change.type === "duplicateSection")).toBe(true);
    expect(changes.some((change) => change.type === "text")).toBe(true);
    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/index.html");
    expect(await page.locator("[data-xyle-node]").count()).toBe(0);
    expect(await page.getByText("WebMCP duplicate edit").count()).toBe(1);
  });

  test("reports conservative Group move capabilities", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/groups-layouts.html");
    const groups = (await invokeTool(page, "list_groups", {})) as Array<{
      id: string;
      move: { supported: boolean; reason?: string };
    }>;
    const layouts = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return [...doc.querySelectorAll<HTMLElement>("[data-xyle-group]")].map((group) => ({
        id: group.dataset.xyleGroup,
        className: group.className,
      }));
    });
    const capabilityFor = (className: string) => {
      const id = layouts.find((layout) => layout.className === className)?.id;
      return groups.find((group) => group.id === id)?.move;
    };
    expect(capabilityFor("cards")).toEqual({ supported: true });
    expect(capabilityFor("flex-cards")).toEqual({ supported: true });
    expect(capabilityFor("grid-cards")).toEqual({ supported: true });
    expect(capabilityFor("reverse-cards")?.supported).toBe(false);
    expect(capabilityFor("explicit-cards")?.supported).toBe(false);
  });

  test("moves an edited Group item through WebMCP", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/groups-move.html");
    const groups = (await invokeTool(page, "list_groups", {})) as Array<{
      id: string;
      move: { supported: boolean; reason?: string };
      items: Array<{ id: string }>;
    }>;
    expect(groups[0]!.move).toEqual({ supported: true });
    const groupId = groups[0]!.id;
    const sourceItemId = groups[0]!.items[1]!.id;
    const targetItemId = groups[0]!.items[0]!.id;
    const titleId = await page.evaluate((itemId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
        ?.querySelector<HTMLElement>("h2[data-xyle-node]")
        ?.getAttribute("data-xyle-node");
    }, sourceItemId);
    const imageId = await page.evaluate((itemId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
        ?.querySelector<HTMLImageElement>("img[data-xyle-node]")
        ?.getAttribute("data-xyle-node");
    }, sourceItemId);
    expect(titleId).toBeTruthy();
    expect(imageId).toBeTruthy();
    await invokeTool(page, "update_text", { id: titleId, text: "Moved service" });
    await invokeTool(page, "update_media", {
      id: imageId,
      crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
      focus: { x: 0.6, y: 0.4 },
      fit: "cover",
    });
    const moved = await invokeTool(page, "move_group_item", {
      groupId,
      itemId: sourceItemId,
      targetItemId,
      position: "before",
    });
    expect(moved).toEqual({ id: sourceItemId, targetItemId, position: "before" });
    const currentOrder = () =>
      page.evaluate(() => {
        const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
        return [...doc.querySelectorAll("[data-xyle-group-item] h2")].map(
          (heading) => heading.textContent,
        );
      });
    await expect.poll(currentOrder).toEqual(["Moved service", "Leaks"]);
    await page.keyboard.press("Control+z");
    await expect.poll(currentOrder).toEqual(["Leaks", "Moved service"]);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(currentOrder).toEqual(["Moved service", "Leaks"]);
    const changes = (await invokeTool(page, "list_changes", {})) as Array<{
      changeId: string;
      type: string;
    }>;
    expect(changes.filter((change) => change.type === "moveGroupItem")).toHaveLength(1);
    await invokeTool(page, "revert_change", {
      changeId: changes.find((change) => change.type === "moveGroupItem")!.changeId,
    });
    await expect.poll(currentOrder).toEqual(["Leaks", "Water heaters"]);
    await page.keyboard.press("Control+z");
    await expect.poll(currentOrder).toEqual(["Moved service", "Leaks"]);
    const publishResponse = page.waitForResponse((response) =>
      response.url().includes("/__xyle/api/publish"),
    );
    await page.locator("#xyle-publish").click();
    expect((await publishResponse).ok()).toBe(true);
    await page.goto("/groups-move.html");
    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.locator("article h2").first()).toContainText("Moved service");
    await expect(page.locator("article img").first()).toHaveAttribute("src", /__media\//);
  });

  test("lists and duplicates a Group item through WebMCP", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/groups.html");
    const groups = (await invokeTool(page, "list_groups", {})) as Array<{
      id: string;
      items: Array<{ id: string }>;
    }>;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
    const groupId = groups[0]!.id;
    const sourceItemId = groups[0]!.items[0]!.id;
    const duplicate = (await invokeTool(page, "duplicate_group_item", {
      groupId,
      itemId: sourceItemId,
    })) as { id: string; groupId: string; sourceItemId: string };
    expect(duplicate).toEqual({
      id: expect.stringMatching(/^x-[a-f0-9]{16}$/),
      groupId,
      sourceItemId,
    });

    const titleId = await page.evaluate((itemId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
        ?.querySelector<HTMLElement>("h2[data-xyle-node]")
        ?.getAttribute("data-xyle-node");
    }, duplicate.id);
    const imageId = await page.evaluate((itemId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
        ?.querySelector<HTMLImageElement>("img[data-xyle-node]")
        ?.getAttribute("data-xyle-node");
    }, duplicate.id);
    expect(titleId).toBeTruthy();
    expect(imageId).toBeTruthy();
    await expect(
      invokeTool(page, "update_formatting", { id: titleId, format: "heading-3" }),
    ).resolves.toMatchObject({ id: titleId, format: "heading-3" });
    const formattingChange = (
      (await invokeTool(page, "list_changes", {})) as Array<{
        changeId: string;
        elementId: string;
        type: string;
        before: string;
        after: string;
      }>
    ).find((change) => change.elementId === titleId && change.type === "html");
    expect(formattingChange).toMatchObject({
      before: expect.stringContaining("<h2"),
      after: expect.stringContaining("<h3"),
    });
    await expect(
      invokeTool(page, "revert_change", { changeId: formattingChange!.changeId }),
    ).resolves.toMatchObject({ undone: true });
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${titleId}"]`),
    ).toHaveJSProperty("tagName", "H2");
    await invokeTool(page, "update_formatting", { id: titleId, format: "heading-3" });
    await invokeTool(page, "update_text", { id: titleId, text: "Duplicated service" });
    await invokeTool(page, "update_media", {
      id: imageId,
      crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
      focus: { x: 0.6, y: 0.4 },
      fit: "cover",
    });
    const listedAgain = (await invokeTool(page, "list_groups", {})) as typeof groups;
    expect(listedAgain[0]!.items.map((item) => item.id)).toEqual(
      groups[0]!.items.map((item) => item.id),
    );

    const publishResponse = page.waitForResponse((response) =>
      response.url().includes("/__xyle/api/publish"),
    );
    await page.locator("#xyle-publish").click();
    const publishResult = await publishResponse;
    expect(publishResult.ok()).toBe(true);
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/groups.html");
    await expect(page.locator("article")).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 3, name: "Duplicated service" })).toHaveCount(
      1,
    );
  });

  test("sets a physical region order through WebMCP", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/layouts.html");
    const sections = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const section = sections.find(
      (item) => item.type === "section" && item.preview.includes("Safe layout"),
    );
    expect(section?.id).toBeTruthy();
    await expect(
      invokeTool(page, "set_region_order", { targetId: section!.id, order: "swapped" }),
    ).resolves.toMatchObject({ id: section!.id, order: "swapped" });
    const preview = page.frameLocator("#xyle-preview");
    await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);
    await expect(preview.locator("#layout-basic > div").nth(1)).toHaveClass(/layout-image/);
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "setRegionOrder" })]),
    );
  });

  test("lists and sets a safe layout preset through WebMCP", async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium" || test.info().project.name !== "webmcp",
      "Run this test in the dedicated Chrome WebMCP project",
    );
    await loginAndOpenEditor(page, "/layouts.html");
    const sections = (await invokeTool(page, "list_editable_content", {})) as Array<{
      id: string;
      type: string;
      preview: string;
    }>;
    const section = sections.find(
      (item) => item.type === "section" && item.preview.includes("Safe layout"),
    );
    expect(section?.id).toBeTruthy();
    await expect(
      invokeTool(page, "list_layout_options", { targetId: section!.id }),
    ).resolves.toMatchObject({
      id: section!.id,
      current: "stacked",
      options: ["stacked", "two-column"],
    });
    await expect(
      invokeTool(page, "set_layout", { targetId: section!.id, preset: "two-column" }),
    ).resolves.toMatchObject({ id: section!.id, preset: "two-column" });
    await expect(page.frameLocator("#xyle-preview").locator("#layout-basic")).toHaveAttribute(
      "data-xyle-layout",
      "split",
    );
    await expect(invokeTool(page, "list_changes", {})).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "setLayoutPreset" })]),
    );
  });
});
