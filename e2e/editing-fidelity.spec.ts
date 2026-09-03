import { expect, test, type Page } from "@playwright/test";
import {
  clickOutsideToCommit,
  currentOps,
  editNode,
  editorText,
  findNodeByText,
  flashText,
  focusCaret,
  loginAndOpenEditor,
  nodeHtml,
  nodeSkeleton,
  opsCount,
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
    const id = await findNodeByText(page, "We are a");
    const originalHtml = await nodeHtml(page, id!);
    const expectedHtml = originalHtml.replace("human-controlled", "foo bar");
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
      pagePath: ABOUT,
      op: { type: "html", nodeId: id, value: expectedHtml },
    });

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get(ABOUT)).text();
    expect(source).toContain(`<p>${expectedHtml}</p>`);
    expect(source).not.toContain("data-xyle-node");
    expect(source).not.toContain("xyle-editing");

    await page.goto(ABOUT);
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
    // either refused+reverted or flattened — never structural damage
    expect(skeletonAfter === skeletonBefore || !(await nodeHtml(page, id!)).includes("<b")).toBe(
      true,
    );
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

  test("selection crossing the <strong> boundary is reverted", async () => {
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

  test("Enter is rejected in headings", async () => {
    const h1 = await findNodeByText(page, "See how Xyle works");
    await editNode(page, h1!);
    await focusCaret(page, h1!, "end");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    expect(await nodeHtml(page, h1!)).not.toContain("<br");
    expect(await flashText(page)).toMatch(/line-break editing is deferred/i);
  });

  test("line-break editing is deferred in paragraphs", async () => {
    const id = await findNodeByText(page, "Editors change content");
    await editNode(page, id!);
    await focusCaret(page, id!, "start");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Enter");
    await page.waitForTimeout(150);
    expect(await nodeHtml(page, id!)).not.toMatch(/<br(?:\s[^>]*)?>/);
    expect(await flashText(page)).toMatch(/line-break editing is deferred/i);
    await clickOutsideToCommit(page);
    expect(await opsCount(page)).toBe(0);
  });

  test("drag/drop text cannot restructure markup", async () => {
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
