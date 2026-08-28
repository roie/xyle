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
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("XYZ");
    await commitAndAssertOp("XYZ");
  });

  test("Backspace removes last character", async () => {
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.press("Backspace");
    await clickOutsideToCommit(page);
    const op = await textOpFor(page);
    expect(op).toBeTruthy();
    expect(await editorText(page, id!)).not.toMatch(/toolbox.$/);
  });

  test("Delete removes first character", async () => {
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "start");
    await page.keyboard.press("Delete");
    await clickOutsideToCommit(page);
    const op = await textOpFor(page);
    expect(op).toBeTruthy();
    expect(op!.value[0] as string).not.toBe("R");
  });

  test("selection replacement within a single segment", async () => {
    const id = await findNodeByText(page, "The crew behind Riverbend");
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
    await page.keyboard.insertText("Meet the crew");
    await commitAndAssertOp("Meet the crew");
  });

  test("plain paste inserts text", async () => {
    const id = await findNodeByText(page, "Riverbend Plumbing started");
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
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText("🔧");
    await commitAndAssertOp("🔧");
  });

  test("multi-code-point grapheme (family emoji)", async () => {
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText("👨‍👩‍👧");
    await commitAndAssertOp("👨‍👩‍👧");
  });

  test("Japanese IME composition commits composed text", async () => {
    const id = await findNodeByText(page, "Riverbend Plumbing started");
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
    const id = await findNodeByText(page, "Riverbend Plumbing started");
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
      range.setEnd(inner, 6); // into "family"
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
    const h1 = await findNodeByText(page, "The crew behind Riverbend");
    await editNode(page, h1!);
    await focusCaret(page, h1!, "end");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    expect(await nodeHtml(page, h1!)).not.toContain("<br");
    expect(await flashText(page)).toMatch(/line-break editing is deferred/i);
  });

  test("line-break editing is deferred in paragraphs", async () => {
    const id = await findNodeByText(page, "Do the small jobs well");
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
    // about.html footer contains a tel link label; use blockquote with quotes? Use paragraph text.
    const id = await findNodeByText(page, "river valley cleanup");
    // that text lives inside <em>; its parent paragraph is the candidate
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.insertText(" & Co");
    await commitAndAssertOp(" & Co");
  });
});
