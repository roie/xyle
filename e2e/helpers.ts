import { expect, type Page, type TestInfo } from "@playwright/test";

export const TEST_KEY = process.env.XYLE_TEST_KEY ?? "xyle-e2e-test-key-0123456789abcdef";

/** Log in through the API and open the editor on a page. */
export async function loginAndOpenEditor(page: Page, pagePath = "/index.html"): Promise<void> {
  await page.request.post("/__xyle/api/login", {
    data: { key: TEST_KEY },
  });
  await page.goto(`/edit?page=${encodeURIComponent(pagePath)}`);
  await waitForEditorReady(page);
}

export async function waitForEditorReady(page: Page): Promise<void> {
  await expect(page.locator("#xyle-preview")).toBeVisible();
  await page.waitForFunction(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement | null)
      ?.contentDocument;
    return !!doc && doc.querySelectorAll("[data-xyle-node]").length > 0;
  });
}

export async function opsCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as never as { __xyle?: { count: number } }).__xyle?.count ?? -1,
  );
}

export async function currentOps(
  page: Page,
): Promise<Array<{ pagePath: string; op: Record<string, unknown> }>> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __xyle?: { ops: Array<{ pagePath: string; op: Record<string, unknown> }> };
        }
      ).__xyle?.ops ?? [],
  );
}

/** Find the ephemeral node id of the candidate whose text contains `needle`. */
export async function findNodeByText(page: Page, needle: string): Promise<string | null> {
  return page.evaluate((text) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    for (const el of doc.querySelectorAll("[data-xyle-node]")) {
      if ((el.textContent ?? "").includes(text)) return el.getAttribute("data-xyle-node");
    }
    return null;
  }, needle);
}

/** Structural skeleton of a candidate (elements only) — mirrors editor validation. */
export async function nodeSkeleton(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    let out = "";
    const walk = (node: Node): void => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      out += `<${(node as Element).tagName}>`;
      for (const child of Array.from(node.childNodes)) walk(child);
    };
    const el = doc.querySelector(`[data-xyle-node="${id}"]`)!;
    for (const child of Array.from(el.childNodes)) walk(child);
    return out;
  }, nodeId);
}

export async function flashText(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById("xyle-flash")?.textContent ?? "");
}

export async function clickNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    const el = doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement;
    el.scrollIntoView({ block: "center" });
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, nodeId);
}

/** Click-to-edit a candidate and wait until it becomes contenteditable. */
export async function editNode(page: Page, nodeId: string): Promise<void> {
  // A real Playwright click moves browser focus into the iframe, so
  // subsequent keyboard input reaches the preview document.
  await page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${nodeId}"]`).click();
  await page.waitForFunction((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    const el = doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement | null;
    return !!el && el.classList.contains("xyle-editing");
  }, nodeId);
}

export async function setSelection(
  page: Page,
  opts: { nodeId: string; startOffset?: number; endOffset?: number; selectAll?: boolean },
): Promise<void> {
  await page.evaluate(({ nodeId, startOffset, endOffset, selectAll }) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    const win = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentWindow!;
    const el = doc.querySelector(`[data-xyle-node="${nodeId}"]`) as HTMLElement;
    const selection = win.getSelection()!;
    const range = doc.createRange();
    if (selectAll) {
      range.selectNodeContents(el);
    } else {
      const textNodes: Text[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
          textNodes.push(node as Text);
          return;
        }
        // mirror editor enumeration: skip nested candidate subtrees
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as HTMLElement).hasAttribute("data-xyle-node")
        ) {
          return;
        }
        for (const child of Array.from(node.childNodes)) walk(child);
      };
      for (const child of Array.from(el.childNodes)) walk(child);
      const first = textNodes[0]!;
      const last = textNodes.at(-1)!;
      range.setStart(first, Math.min(startOffset ?? 0, first.length));
      range.setEnd(last, Math.min(endOffset ?? last.length, last.length));
    }
    selection.removeAllRanges();
    selection.addRange(range);
    el.focus();
  }, opts);
}

export async function focusCaret(
  page: Page,
  nodeId: string,
  where: "start" | "end",
): Promise<void> {
  await setSelection(page, {
    nodeId,
    ...(where === "start" ? { startOffset: 0, endOffset: 0 } : {}),
    ...(where === "end" ? {} : {}),
  });
  if (where === "end") {
    await page.evaluate((id) => {
      const iframe = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const win = iframe.contentWindow!;
      const el = iframe.contentDocument!.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement;
      const selection = win.getSelection()!;
      const range = win.document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      el.focus();
    }, nodeId);
  }
}

export async function clickOutsideToCommit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shell = document.getElementById("xyle-bar-left")!;
    shell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

export async function pressInEditor(
  page: Page,
  key: string,
  opts?: { delay?: number },
): Promise<void> {
  await page.keyboard.press(key, opts);
}

export async function editorText(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement).textContent ?? "";
  }, nodeId);
}

export async function nodeHtml(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement).innerHTML;
  }, nodeId);
}

export function browserName(info: TestInfo): string {
  return info.project.name;
}
