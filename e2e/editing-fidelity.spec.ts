import { expect, test, type Page } from "@playwright/test";
import {
  clickOutsideToCommit,
  currentOps,
  editNode,
  editorText,
  findNodeByText,
  focusCaret,
  loginAndOpenEditor,
  nodeHtml,
  nodeSkeleton,
  opsCount,
  setSelection,
} from "./helpers.ts";

/**
 * HARD GATE: editing fidelity across Chromium, Firefox and WebKit.
 * Every case must produce (A) a safe unambiguous ChangeSet op, or
 * (B) an explicit refusal/revert. There is no third outcome.
 */

const ABOUT = "/about.html";

async function textOpFor(page: Page): Promise<{ nodeId: string; value: string } | null> {
  const ops = await currentOps(page);
  const last = ops.at(-1);
  if (!last || last.op.type !== "text") return null;
  return { nodeId: String(last.op.nodeId), value: String(last.op.value) };
}

async function committedTextFor(page: Page): Promise<string | null> {
  const ops = await currentOps(page);
  const last = ops.at(-1);
  if (!last || (last.op.type !== "text" && last.op.type !== "html")) return null;
  if (last.op.type === "text") return String(last.op.value);
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent ?? "";
  }, String(last.op.value));
}

test.describe("editing fidelity gate", () => {
  let page: Page;

  test.beforeEach(async ({ page: p }, info) => {
    page = p;
    await loginAndOpenEditor(page, ABOUT);
    void info;
  });

  async function commitAndAssertOp(expectedSuffix: string): Promise<void> {
    await clickOutsideToCommit(page);
    await expect.poll(async () => opsCount(page)).toBeGreaterThan(0);
    const value = await committedTextFor(page);
    expect(value, "expected a safe text or markup op").toBeTruthy();
    expect(value!.endsWith(expectedSuffix)).toBe(true);
  }

  test("ASCII typing", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("XYZ");
    await commitAndAssertOp("XYZ");
  });

  test("keyboard spaces survive plain text publish and reload", async () => {
    const id = await findNodeByText(page, "Human visual editing and WebMCP");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" hello world");
    await clickOutsideToCommit(page);

    expect((await editorText(page, id!)).endsWith(" hello world")).toBe(true);
    const op = await textOpFor(page);
    expect(op?.value.endsWith(" hello world")).toBe(true);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(await (await page.request.get(ABOUT)).text()).toContain("hello world");
    await page.goto(`/edit?page=${encodeURIComponent(ABOUT)}`);
    await expect(page.locator("#xyle-preview")).toBeVisible();
    const reloadedId = await findNodeByText(page, "hello world");
    expect((await editorText(page, reloadedId!)).endsWith(" hello world")).toBe(true);
  });

  test("keyboard spaces survive inline formatting boundaries", async () => {
    const pagePath = "/index.html";
    await loginAndOpenEditor(page, pagePath);
    const id = await findNodeByText(page, "We are a");
    const originalHtml = await nodeHtml(page, id!);
    const expectedHtml = originalHtml.replace("small editing layer", "foo bar");
    await editNode(page, id!);
    await page.evaluate((nodeId) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const container = frame.contentDocument!.querySelector(
        `[data-xyle-node="${nodeId}"]`,
      ) as HTMLElement;
      const strong = container.querySelector("strong")!;
      container.focus();
      const range = frame.contentDocument!.createRange();
      range.selectNodeContents(strong);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, id);
    await page.keyboard.type("foo bar");
    await clickOutsideToCommit(page);

    expect(await nodeHtml(page, id!)).toBe(expectedHtml);
    const ops = await currentOps(page);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      pagePath,
      op: { type: "html", nodeId: id, value: expectedHtml },
    });

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(pagePath)).text();
    expect(source).toContain(`<p>${expectedHtml}</p>`);
    expect(source).not.toContain("data-xyle-node");
    expect(source).not.toContain("xyle-editing");

    await page.goto(pagePath);
    const published = page.locator("p").filter({ hasText: "We are a foo bar" });
    await expect(published).toHaveCount(1);
    expect(await published.evaluate((element) => element.innerHTML)).toBe(expectedHtml);
  });

  test("keyboard spaces preserve meaningful leading and trailing text", async () => {
    const id = await findNodeByText(page, "Your website stays where it belongs.");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" hello world ");
    await clickOutsideToCommit(page);

    const expectedText = await editorText(page, id!);
    expect(expectedText.endsWith(" hello world ")).toBe(true);
    expect((await textOpFor(page))?.value).toBe(expectedText);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain(" hello world ");
    expect(source).not.toContain("data-xyle-node");

    await page.goto(ABOUT);
    const published = page
      .locator("h2")
      .filter({ hasText: "Your website stays where it belongs." });
    expect(((await published.textContent()) ?? "").endsWith(" hello world ")).toBe(true);
  });

  test("Backspace removes last character", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.press("Backspace");
    await clickOutsideToCommit(page);
    const op = await textOpFor(page);
    expect(op).toBeTruthy();
    expect(await editorText(page, id!)).not.toMatch(/assets\.$/);
  });

  test("Delete removes first character", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "start");
    await page.keyboard.press("Delete");
    await clickOutsideToCommit(page);
    const op = await textOpFor(page);
    expect(op).toBeTruthy();
    expect(op!.value[0] as string).not.toBe("T");
  });

  test("selection replacement within a single segment", async () => {
    const id = await findNodeByText(page, "See how Xyle works");
    await editNode(page, id!);
    await page.evaluate((nodeId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const el = doc.querySelector(`[data-xyle-node="${nodeId}"]`) as HTMLElement;
      const win = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentWindow!;
      const range = win.document.createRange();
      range.selectNodeContents(el);
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      el.focus();
    }, id);
    await page.keyboard.insertText("Explore the workflow");
    await commitAndAssertOp("Explore the workflow");
  });

  test("plain paste inserts text", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument!.querySelector(".xyle-editing")!;
      const dt = new DataTransfer();
      dt.setData("text/plain", " PASTED");
      // engines differ on ClipboardEvent ctor support for clipboardData
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: dt });
      target.dispatchEvent(event);
    });
    await page.waitForTimeout(150);
    await commitAndAssertOp("PASTED");
  });

  test("formatted HTML paste is neutralized to plain structure-safe content", async () => {
    await loginAndOpenEditor(page, "/index.html");
    const skeletonBefore = await nodeSkeleton(page, (await findNodeByText(page, "We are a"))!);
    const id = await findNodeByText(page, "We are a");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    // simulate the browser having accepted rich paste:
    const iframe = page.locator("#xyle-preview");
    void iframe;
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const win = frame.contentWindow!;
      const target = frame.contentDocument!.querySelector(".xyle-editing") as HTMLElement;
      target.focus();
      win.document.execCommand("insertHTML", false, "<b data-x='x'>BOLD</b>");
    });
    await page.waitForTimeout(200);
    const skeletonAfter = await nodeSkeleton(page, id!);
    const htmlAfter = await nodeHtml(page, id!);
    expect(skeletonAfter).toBe(skeletonBefore);
    expect(htmlAfter).not.toContain("<b");
    expect(htmlAfter).not.toContain("data-x=");
  });

  test("emoji typing", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText("🔧");
    await commitAndAssertOp("🔧");
  });

  test("multi-code-point grapheme (family emoji)", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText("👨‍👩‍👧");
    await commitAndAssertOp("👨‍👩‍👧");
  });

  test("Japanese IME composition commits composed text", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument!.querySelector(".xyle-editing") as HTMLElement;
      target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await page.keyboard.insertText("こんにちは");
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument!.querySelector(".xyle-editing") as HTMLElement;
      target.dispatchEvent(
        new CompositionEvent("compositionupdate", { bubbles: true, data: "こんにちは" }),
      );
      target.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "こんにちは" }),
      );
    });
    await commitAndAssertOp("こんにちは");
  });

  test("inline formatting publishes through human controls", async () => {
    const formats = [
      {
        text: "See how Xyle works",
        button: "Bold",
        selector: 'strong[data-xyle-format="bold"]',
        publicSelector: "#about-title strong",
      },
      {
        text: "Built around reviewable changes.",
        button: "Italic",
        selector: 'em[data-xyle-format="italic"]',
        publicSelector: "#story-title em",
      },
      {
        text: "One safe path for people and agents.",
        button: "Underline",
        selector: 'u[data-xyle-format="underline"]',
        publicSelector: "#crew-title u",
      },
      {
        text: "Your website stays where it belongs.",
        button: "Strikethrough",
        selector: 's[data-xyle-format="strikethrough"]',
        publicSelector: "#community-title s",
      },
    ];

    for (const format of formats) {
      const nodeId = await findNodeByText(page, format.text);
      expect(nodeId).toBeTruthy();
      await editNode(page, nodeId!);
      await setSelection(page, { nodeId: nodeId!, selectAll: true });
      await page.locator(".xyle-format-tools").getByRole("button", { name: format.button }).click();
      await expect
        .poll(() =>
          page
            .frameLocator("#xyle-preview")
            .locator(`[data-xyle-node="${nodeId}"]`)
            .locator(format.selector)
            .count(),
        )
        .toBe(1);
    }

    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual([
      "html",
      "html",
      "html",
      "html",
    ]);
    await page.locator("#xyle-changes").click();
    const changes = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(changes).toHaveCount(formats.length);
    for (const format of formats) {
      await expect(changes.filter({ hasText: format.text })).toHaveCount(1);
    }
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain("<strong>See how Xyle works</strong>");
    expect(source).toContain("<em>Built around reviewable changes.</em>");
    expect(source).toContain("<u>One safe path for people and agents.</u>");
    expect(source).not.toContain("data-xyle-format");

    await page.goto(ABOUT);
    for (const format of formats) {
      await expect(page.locator(format.publicSelector)).toHaveText(format.text);
    }
  });

  test("highlighted text becomes a safe reviewable link", async () => {
    const nodeId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, nodeId!);
    await setSelection(page, { nodeId: nodeId!, startOffset: 8, endOffset: 12 });
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Add link" }).click();
    const form = page.locator(".xyle-format-tools form");
    await form.getByLabel("Link destination").fill("example.com/guide");
    await form.getByRole("button", { name: "Add link" }).click();

    const link = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${nodeId}"] a`, { hasText: "Xyle" });
    await expect(link).toHaveAttribute("href", "https://example.com/guide");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["html"]);

    await page.keyboard.press("Control+z");
    await expect(link).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await expect(link).toHaveAttribute("href", "https://example.com/guide");

    await link.click();
    const linkTools = page.locator(".xyle-link-tools");
    await expect(linkTools.getByRole("button", { name: "Edit URL" })).toBeVisible();
    await expect(page.locator("#xyle-flash")).not.toContainText(
      "External links do not navigate in edit mode",
    );
    await linkTools.getByRole("button", { name: "Edit URL" }).click();
    const editForm = linkTools.locator("form");
    await editForm.getByLabel("Link destination").fill("/updated-guide");
    await editForm.getByRole("button", { name: "Save" }).click();
    await expect(link).toHaveAttribute("href", "/updated-guide");
    await linkTools.getByRole("button", { name: "Edit URL" }).click();
    await linkTools.getByLabel("Link destination").fill("/updated-guide-again");
    await linkTools.getByRole("button", { name: "Save" }).click();
    await expect(link).toHaveAttribute("href", "/updated-guide-again");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["html"]);

    await page.keyboard.press("Control+z");
    await expect(link).toHaveAttribute("href", "/updated-guide");
    await page.keyboard.press("Control+Shift+z");
    await expect(link).toHaveAttribute("href", "/updated-guide-again");

    await page.locator("#xyle-changes").click();
    const change = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(change).toContainText("/updated-guide-again");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain(
      '<h1 id="about-title">See how <a href="/updated-guide-again">Xyle</a> works</h1>',
    );
  });

  test("link creation rejects unsafe URLs without changing the page", async () => {
    const nodeId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, nodeId!);
    await setSelection(page, { nodeId: nodeId!, startOffset: 8, endOffset: 12 });
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Add link" }).click();
    const form = page.locator(".xyle-format-tools form");
    await form.getByLabel("Link destination").fill("javascript:alert(1)");
    await form.getByRole("button", { name: "Add link" }).click();
    await expect(form.getByRole("status")).toContainText("Use /path");
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${nodeId}"] a`),
    ).toHaveCount(0);
    expect(await opsCount(page)).toBe(0);
  });

  test("Changes shows compact raw HTML around a formatting edit", async () => {
    const nodeId = await findNodeByText(page, "The first Xyle edits happen");
    expect(nodeId).toBeTruthy();
    await editNode(page, nodeId!);
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector<HTMLElement>(
        `[data-xyle-node="${id}"]`,
      )!;
      const text = [...element.childNodes].find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").includes("separate database"),
      )!;
      const start = text.data.indexOf("separate database");
      const range = frame.contentDocument!.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "separate database".length);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      frame.contentDocument!.dispatchEvent(new Event("selectionchange"));
    }, nodeId!);
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Italic" }).click();
    await clickOutsideToCommit(page);

    await page.locator("#xyle-changes").click();
    const row = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    const before = (await row.locator(".xyle-change-before").textContent()) ?? "";
    const after = (await row.locator(".xyle-change-after").textContent()) ?? "";
    expect(before).toContain("…");
    expect(before).toContain("separate database");
    expect(after).toContain("<em>separate database</em>");
    expect(after).not.toContain('class=""');
    expect(before).not.toContain("The first Xyle edits happen");
    expect(after.length).toBeLessThan(150);
  });

  test("choosing the current heading style does not create a formatting change", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    expect(headingId).toBeTruthy();
    await editNode(page, headingId!);
    await setSelection(page, { nodeId: headingId!, selectAll: true });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("heading-1");

    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("block styles publish in both directions and survive reload", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    const paragraphId = await findNodeByText(page, "Editors change content");
    expect(headingId).toBeTruthy();
    expect(paragraphId).toBeTruthy();

    await editNode(page, headingId!);
    await setSelection(page, { nodeId: headingId!, selectAll: true });
    const headingStyle = page.locator('.xyle-format-tools select[aria-label="Block style"]');
    await headingStyle.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    const changedHeading = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${headingId}"]`);
    await expect(changedHeading).toHaveJSProperty("tagName", "P");

    await editNode(page, paragraphId!);
    await setSelection(page, { nodeId: paragraphId!, selectAll: true });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("heading-2");
    const changedParagraph = page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${paragraphId}"]`);
    await expect(changedParagraph).toHaveJSProperty("tagName", "H2");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual([
      "setBlockFormat",
      "setBlockFormat",
    ]);

    await page.locator("#xyle-changes").click();
    const changes = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(changes).toHaveCount(2);
    await expect(changes.nth(0).locator(".xyle-change-before")).toContainText("<h1");
    await expect(changes.nth(0).locator(".xyle-change-after")).toContainText("<p");
    await expect(changes.nth(1).locator(".xyle-change-before")).toContainText("<p>");
    await expect(changes.nth(1).locator(".xyle-change-after")).toContainText("<h2");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toMatch(/<p[^>]*>See how Xyle works<\/p>/);
    expect(source).toMatch(/<h2[^>]*>\s*Editors change content/);
    expect(source).not.toContain("data-xyle-node");

    await page.goto(ABOUT);
    await expect(page.locator("p", { hasText: "See how Xyle works" })).toHaveCount(1);
    await expect(page.locator("h2", { hasText: "Editors change content" })).toHaveCount(1);
  });

  test("undo removes the pending change; redo restores it", async () => {
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("AAA");
    await clickOutsideToCommit(page);
    expect(await opsCount(page)).toBe(1);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(120);
    expect(await opsCount(page)).toBe(0);

    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(120);
    expect(await opsCount(page)).toBe(1);
  });

  test("editing fully inside <strong> preserves the strong element", async () => {
    await loginAndOpenEditor(page, "/index.html");
    const pId = await findNodeByText(page, "We are a");
    const before = await nodeSkeleton(page, pId!);
    await editNode(page, pId!);
    // caret inside strong: select strong contents then type
    await setSelectionInsideStrong();
    await page.keyboard.type("worker-owned");

    async function setSelectionInsideStrong(): Promise<void> {
      await page.evaluate((nodeId) => {
        const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
        const win = frame.contentWindow!;
        const container = frame.contentDocument!.querySelector(
          `[data-xyle-node="${nodeId}"]`,
        ) as HTMLElement;
        const strong = container.querySelector("strong")!;
        const range = win.document.createRange();
        range.selectNodeContents(strong);
        const selection = win.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        container.focus();
      }, pId);
    }

    await clickOutsideToCommit(page);
    expect(await nodeSkeleton(page, pId!)).toContain("<STRONG>");
    expect(await nodeSkeleton(page, pId!)).toBe(before.replace("<STRONG>", "<STRONG>"));
    const html = await nodeHtml(page, pId!);
    expect(html).toContain("<strong>worker-owned</strong>");
  });

  test("edits across multiple authored inline boundaries survive publication", async () => {
    await loginAndOpenEditor(page, "/index.html");
    const pagePath = "/index.html";
    const nodeId = await findNodeByText(page, "We are a");
    expect(nodeId).toBeTruthy();
    const originalHtml = await nodeHtml(page, nodeId!);
    const replacements = [
      { selector: "strong", value: "careful editing layer" },
      { selector: "em", value: "one visible history" },
    ];

    for (const replacement of replacements) {
      await editNode(page, nodeId!);
      await page.evaluate(
        ({ id, selector }) => {
          const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
          const element = frame.contentDocument!.querySelector<HTMLElement>(
            `[data-xyle-node="${id}"]`,
          )!;
          const inline = element.querySelector(selector)!;
          const range = frame.contentDocument!.createRange();
          range.selectNodeContents(inline);
          const selection = frame.contentWindow!.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          element.focus();
          frame.contentDocument!.dispatchEvent(new Event("selectionchange"));
        },
        { id: nodeId!, selector: replacement.selector },
      );
      await page.keyboard.type(replacement.value);
      await clickOutsideToCommit(page);
      await expect
        .poll(async () => nodeHtml(page, nodeId!))
        .toContain(`<${replacement.selector}>${replacement.value}</${replacement.selector}>`);
    }

    const expectedHtml = originalHtml
      .replace("small editing layer", replacements[0]!.value)
      .replace("one shared history", replacements[1]!.value);
    expect(await nodeHtml(page, nodeId!)).toBe(expectedHtml);
    expect(await currentOps(page)).toEqual([
      {
        pagePath,
        op: { type: "html", nodeId, value: expectedHtml },
      },
    ]);

    await page.locator("#xyle-changes").click();
    const change = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(change).toHaveCount(1);
    await expect(change.locator(".xyle-change-before")).toContainText("small editing layer");
    await expect(change.locator(".xyle-change-before")).toContainText("one shared history");
    await expect(change.locator(".xyle-change-after")).toContainText("careful editing layer");
    await expect(change.locator(".xyle-change-after")).toContainText("one visible history");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(pagePath)).text();
    expect(source).toContain(`<p>${expectedHtml}</p>`);
    expect(source).not.toContain("data-xyle-node");

    await page.goto(pagePath);
    const published = page.locator("p").filter({ hasText: "careful editing layer" });
    await expect(published).toHaveCount(1);
    expect(await published.evaluate((element) => element.innerHTML)).toBe(expectedHtml);
  });

  test("selection crossing the <strong> boundary is reverted", async () => {
    await loginAndOpenEditor(page, "/index.html");
    const pId = await findNodeByText(page, "We are a");
    const before = await nodeSkeleton(page, pId!);
    await editNode(page, pId!);
    await page.evaluate((nodeId) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const win = frame.contentWindow!;
      const container = frame.contentDocument!.querySelector(
        `[data-xyle-node="${nodeId}"]`,
      ) as HTMLElement;
      const strong = container.querySelector("strong")!;
      const first = container.firstChild as Text;
      const inner = strong.firstChild as Text;
      const range = win.document.createRange();
      range.setStart(first, Math.max(0, first.length - 2)); // "a "
      range.setEnd(inner, 4); // into "small"
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      container.focus();
    }, pId);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
    expect(await nodeSkeleton(page, pId!)).toBe(before);
    expect(await opsCount(page)).toBe(0);
  });

  test("Enter after a heading creates an editable paragraph", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, headingId!);
    await focusCaret(page, headingId!, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A new paragraph.");
    await clickOutsideToCommit(page);

    const heading = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${headingId}"]`);
    await expect(heading).toHaveText("See how Xyle works");
    await expect(heading.locator("+ p")).toHaveText("A new paragraph.");
    const operations = await currentOps(page);
    expect(operations.some((entry) => entry.op.type === "replaceTextBlock")).toBe(true);
    await page.locator("#xyle-changes").click();
    const change = page.locator("#xyle-changes-drawer .xyle-change-row").first();
    await expect(change.locator(".xyle-change-before")).toContainText("<h1");
    await expect(change.locator(".xyle-change-after")).toContainText("<p>A new paragraph.</p>");
  });

  test("publishes deletion after creating a draft paragraph inside the area", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, headingId!);
    await focusCaret(page, headingId!, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Draft-only paragraph.");
    await clickOutsideToCommit(page);

    await page.locator("#xyle-structure-shortcut").click();
    const row = page
      .getByRole("dialog", { name: "Outline" })
      .locator(".xyle-outline-node")
      .filter({ hasText: "See how Xyle works" });
    await row.locator(".xyle-outline-menu-trigger").click();
    await row.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const publishResponse = page.waitForResponse((response) =>
      response.url().includes("/__xyle/api/publish"),
    );
    await page.locator("#xyle-publish").click();
    expect((await publishResponse).ok()).toBe(true);
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get("/about.html")).text();
    expect(source).not.toContain('class="page-intro"');
    expect(source).not.toContain("Draft-only paragraph.");
  });

  test("paragraph creation has chronological undo and redo", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, headingId!);
    await focusCaret(page, headingId!, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Undoable paragraph.");
    await clickOutsideToCommit(page);
    const paragraph = page
      .frameLocator("#xyle-preview")
      .getByText("Undoable paragraph.", { exact: true });
    const paragraphId = await paragraph.getAttribute("data-xyle-node");

    await page.keyboard.press("Control+z");
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${paragraphId}"]`),
    ).toHaveText("");
    await page.keyboard.press("Control+z");
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${paragraphId}"]`),
    ).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await page.keyboard.press("Control+Shift+z");
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${paragraphId}"]`),
    ).toHaveText("Undoable paragraph.");
  });

  test("links in generated paragraphs stay in the replacement operation", async () => {
    const headingId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, headingId!);
    await focusCaret(page, headingId!, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Generated link paragraph.");
    await clickOutsideToCommit(page);
    const paragraph = page
      .frameLocator("#xyle-preview")
      .getByText("Generated link paragraph.", { exact: true });
    const paragraphId = await paragraph.getAttribute("data-xyle-node");

    await editNode(page, paragraphId!);
    await setSelection(page, { nodeId: paragraphId!, startOffset: 0, endOffset: 9 });
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Add link" }).click();
    const form = page.locator(".xyle-format-tools form");
    await form.getByLabel("Link destination").fill("/guide");
    await form.getByRole("button", { name: "Add link" }).click();
    const createdLink = paragraph.locator("a");
    await createdLink.click();
    const linkTools = page.locator(".xyle-link-tools");
    await linkTools.getByRole("button", { name: "Edit URL" }).click();
    await linkTools.getByLabel("Link destination").fill("/updated-guide");
    await linkTools.getByRole("button", { name: "Save" }).click();
    await expect(createdLink).toHaveAttribute("href", "/updated-guide");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["replaceTextBlock"]);

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain('<p><a href="/updated-guide">Generated</a> link paragraph.</p>');
  });

  test("Enter at the start inserts a paragraph before the authored block", async () => {
    const id = await findNodeByText(page, "Editors change content");
    await editNode(page, id!);
    await setSelection(page, { nodeId: id!, startOffset: 0, endOffset: 0 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Intro paragraph.");
    await clickOutsideToCommit(page);

    const sourceBlock = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`);
    await expect(sourceBlock.locator("xpath=preceding-sibling::*[1]")).toHaveText(
      "Intro paragraph.",
    );
    await expect(sourceBlock).toContainText("Editors change content");
  });

  test("Shift+Enter inserts a line break and keeps typing in the paragraph", async () => {
    const id = await findNodeByText(page, "Editors change content");
    await editNode(page, id!);
    await focusCaret(page, id!, "start");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("continued ");
    await clickOutsideToCommit(page);

    expect(await nodeHtml(page, id!)).toMatch(/<br(?:\s[^>]*)?>/);
    const operation = (await currentOps(page)).find((entry) => entry.op.type === "html");
    expect(operation?.op).toMatchObject({
      type: "html",
      nodeId: id,
      value: expect.stringContaining("<br>continued "),
    });
  });

  test("paragraph creation composes across a selection, repeated Enter, formatting, undo, and publish", async () => {
    const id = await findNodeByText(page, "Editors change content");
    await editNode(page, id!);
    await setSelection(page, { nodeId: id!, startOffset: 8, endOffset: 14 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("NEW ");
    const activeParagraphId = await page
      .frameLocator("#xyle-preview")
      .locator("p[data-xyle-node]")
      .filter({ hasText: "NEW content" })
      .getAttribute("data-xyle-node");
    await focusCaret(page, activeParagraphId!, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third paragraph.");
    await clickOutsideToCommit(page);

    const preview = page.frameLocator("#xyle-preview");
    const first = preview.locator(`[data-xyle-node="${id}"]`);
    await expect(first).toHaveText("Editors ");
    const second = first.locator("+ p");
    await expect(second).toContainText("NEW content");
    const third = second.locator("+ p");
    await expect(third).toHaveText("Third paragraph.");
    const thirdId = await third.getAttribute("data-xyle-node");
    await editNode(page, thirdId!);
    await setSelection(page, { nodeId: thirdId!, selectAll: true });
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Bold" }).click();
    await clickOutsideToCommit(page);
    await expect(third.locator("strong")).toHaveText("Third paragraph.");
    await page.keyboard.press("Control+z");
    await expect(third.locator("strong")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await expect(third.locator("strong")).toHaveText("Third paragraph.");

    const operation = (await currentOps(page)).find(
      (entry) => entry.op.type === "replaceTextBlock",
    );
    expect(operation?.op).toMatchObject({
      type: "replaceTextBlock",
      nodeId: id,
      blocks: [
        { tag: "p", source: true },
        { tag: "p", source: false },
        { tag: "p", source: false, html: "<strong>Third paragraph.</strong>" },
      ],
    });

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain("<p>Editors </p>");
    expect(source).toContain("<p>NEW content");
    expect(source).toContain("<p><strong>Third paragraph.</strong></p>");

    await loginAndOpenEditor(page, ABOUT, { resetFixture: false });
    await expect(
      page.frameLocator("#xyle-preview").getByText("Third paragraph.", { exact: true }),
    ).toBeVisible();
  });

  test("Enter in a list fails closed", async () => {
    const listItem = page
      .frameLocator("#xyle-preview")
      .locator("li[data-xyle-node]")
      .filter({ hasText: "Edit in context" })
      .first();
    const listItemId = await listItem.getAttribute("data-xyle-node");
    await editNode(page, listItemId!);
    await focusCaret(page, listItemId!, "end");
    await page.keyboard.press("Enter");
    await expect(page.locator("#xyle-flash")).toContainText(
      "Paragraph breaks are not supported in this text yet",
    );
    expect(await opsCount(page)).toBe(0);
  });

  test("drag/drop text cannot restructure markup", async () => {
    await loginAndOpenEditor(page, "/index.html");
    const pId = await findNodeByText(page, "We are a");
    const before = await nodeSkeleton(page, pId!);
    // simulate a drop that would inject foreign markup
    await page.evaluate((nodeId) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument!.querySelector(
        `[data-xyle-node="${nodeId}"]`,
      ) as HTMLElement;
      const dt = new DataTransfer();
      dt.setData("text/html", "<div>DROPPED-BLOCK</div>");
      const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      Object.defineProperty(event, "target", { value: target });
      target.dispatchEvent(event);
    }, pId);
    await page.waitForTimeout(200);
    expect(await nodeSkeleton(page, pId!)).toBe(before);
  });

  test("decoded entities round-trip (&middot;/&nbsp; semantics)", async () => {
    const id = await findNodeByText(page, "Xyle runs within or beside");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText(" & Co");
    await commitAndAssertOp(" & Co");
  });
});
