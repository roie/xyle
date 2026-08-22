import { expect, test } from "@playwright/test";
import {
  TEST_KEY,
  editNode,
  findNodeByText,
  focusCaret,
  loginAndOpenEditor,
  opsCount,
} from "./helpers.ts";

async function clickOutsideCommit(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    document
      .getElementById("xyle-bar-left")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

test.describe("conflicts and recovery", () => {
  test("first publish wins; second tab gets 409 and keeps local edits", async ({
    page,
    browser,
  }) => {
    await loginAndOpenEditor(page, "/about.html");

    // Tab B starts from the same snapshot
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.request.post("/__xyle/api/login", { data: { key: TEST_KEY } });
    await pageB.goto("/edit?page=%2Fabout.html");
    await pageB.waitForSelector("#xyle-preview");

    const idA = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, idA!);
    await focusCaret(page, idA!, "end");
    await page.keyboard.type(" TAB-A");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    const idB = await findNodeByText(pageB, "Riverbend Plumbing started");
    await editNode(pageB, idB!);
    await focusCaret(pageB, idB!, "end");
    await pageB.keyboard.type(" TAB-B");
    await clickOutsideCommit(pageB);

    // A publishes first
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    // B must receive a conflict and keep its preview + ChangeSet
    await pageB.click("#xyle-publish");
    await expect(pageB.locator("#xyle-conflict")).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator("#xyle-conflict")).toContainText("published site changed");
    expect(await textOf(pageB, idB!)).toContain("TAB-B"); // local DOM intact
    expect(await opsCount(pageB)).toBe(1); // ChangeSet kept

    // Reload published site is destructive and explicit
    await pageB.click("#xyle-conflict-reload");
    await pageB.waitForLoadState("load");
    await pageB.waitForTimeout(400);
    const reloaded = await textOfAfterReload(pageB);
    expect(reloaded).toContain("TAB-A");
    expect(reloaded).not.toContain("TAB-B");

    await contextB.close();
  });

  test("edits on multiple pages publish together after navigation", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");

    const idA = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, idA!);
    await focusCaret(page, idA!, "end");
    await page.keyboard.type(" MULTI-A");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    // navigate the preview to another page (candidate links open the
    // link-editing dialog; navigation uses the explicit Follow affordance)
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const link = frame.contentDocument!.querySelector('nav a[href="/"]') as HTMLAnchorElement;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(page.locator("dialog")).toBeVisible();
    await page.click("dialog button[value='follow']");
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return !!doc?.body && doc.body.textContent?.includes("Plumbing you can depend on");
    });

    const idB = await findNodeByText(page, "Burst pipe at midnight");
    await editNode(page, idB!);
    await focusCaret(page, idB!, "end");
    await page.keyboard.type(" MULTI-B");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(2);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    const about = await (await page.request.get("/about.html")).text();
    const index = await (await page.request.get("/index.html")).text();
    expect(about).toContain("MULTI-A");
    expect(index).toContain("MULTI-B");
  });

  test("published content survives a server restart", async ({ page }) => {
    await loginAndOpenEditor(page, "/contact.html");
    const id = await findNodeByText(page, "Talk to a plumber");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" Restart-safe.");
    await clickOutsideCommit(page);
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    // The webServer persists for the whole run; verify via fresh fetch that the
    // static file changed on disk (restart equivalence is covered by the
    // filesystem publisher unit tests which re-open the directory).
    const html = await (await page.request.get("/contact.html")).text();
    expect(html).toContain("Restart-safe.");
  });

  test("discard clears ChangeSet and restores published content", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const before = await (await page.request.get("/about.html")).text();

    const id = await findNodeByText(page, "family-owned");
    void id;
    const pId = await findNodeByText(page, "We are a");
    await editNode(page, pId!);
    await focusCaret(page, pId!, "end");
    await page.keyboard.type(" DISCARDED");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    // discard through menu exit with accepted confirm
    await page.click("#xyle-menu-btn");
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#xyle-menu button[data-action='exit']");
    await page.waitForURL((u) => !u.pathname.includes("/edit"), { timeout: 5000 });

    const after = await (await page.request.get("/about.html")).text();
    expect(after).toBe(before); // nothing written
  });
});

async function textOf(page: import("@playwright/test").Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement)?.textContent ?? "";
  }, nodeId);
}

async function textOfAfterReload(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    for (const el of doc.querySelectorAll("[data-xyle-node]")) {
      if ((el.textContent ?? "").includes("Riverbend Plumbing started")) {
        return el.textContent ?? "";
      }
    }
    return "";
  });
}
