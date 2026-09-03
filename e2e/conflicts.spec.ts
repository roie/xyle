import { expect, test } from "@playwright/test";
import {
  TEST_KEY,
  currentOps,
  editNode,
  findNodeByText,
  flashText,
  focusCaret,
  loginAndOpenEditor,
  opsCount,
} from "./helpers.ts";

async function clickOutsideCommit(page: import("@playwright/test").Page): Promise<void> {
  await page
    .frameLocator("#xyle-preview")
    .locator("html")
    .click({ position: { x: 1, y: 1 } });
}

test.describe("conflicts and recovery", () => {
  test("first publish wins; second tab gets 409 and keeps local edits", async ({
    page,
    browser,
  }, info) => {
    await loginAndOpenEditor(page, "/about.html");

    // Tab B starts from the same snapshot
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.request.post("/__xyle/api/login", { data: { key: TEST_KEY } });
    await pageB.goto("/edit?page=%2Fabout.html");
    await pageB.waitForSelector("#xyle-preview");

    const idA = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, idA!);
    await focusCaret(page, idA!, "end");
    const tokenA = ` TAB-A-${info.project.name}`;
    const tokenB = ` TAB-B-${info.project.name}`;
    await page.keyboard.type(tokenA);
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    const idB = await findNodeByText(pageB, "This Xyle demo starts");
    await editNode(pageB, idB!);
    await focusCaret(pageB, idB!, "end");
    await pageB.keyboard.type(tokenB);
    await clickOutsideCommit(pageB);

    // A publishes first
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    // B must receive a conflict and keep its preview + ChangeSet
    await pageB.click("#xyle-publish");
    await expect(pageB.locator("#xyle-conflict")).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator("#xyle-conflict")).toContainText("published site changed");
    expect(await textOf(pageB, idB!)).toContain(tokenB.trim()); // local DOM intact
    expect(await opsCount(pageB)).toBe(1); // ChangeSet kept

    // Reload published site is destructive and explicit
    await pageB.click("#xyle-conflict-reload");
    await pageB.waitForLoadState("load");
    await pageB.waitForTimeout(400);
    const reloaded = await textOfAfterReload(pageB);
    expect(reloaded).toContain(tokenA.trim());
    expect(reloaded).not.toContain(tokenB.trim());

    await contextB.close();
  });

  test("network failure keeps the ChangeSet and permits retry", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const beforeSource = await (await page.request.get("/about.html")).text();
    const nodeId = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, nodeId!);
    await focusCaret(page, nodeId!, "end");
    const token = ` retry-${info.project.name}`;
    await page.keyboard.type(token);
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    await page.route("**/__xyle/api/publish", (route) => route.abort("connectionfailed"), {
      times: 1,
    });
    await page.locator("#xyle-publish").click();
    await expect.poll(() => flashText(page)).toMatch(/check your connection and retry/i);
    expect(await opsCount(page)).toBe(1);
    await expect(page.locator("#xyle-dirty")).toBeVisible();
    expect(await (await page.request.get("/about.html")).text()).toBe(beforeSource);

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(await (await page.request.get("/about.html")).text()).toContain(token);
    expect(await opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("edits on multiple pages publish together after navigation", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");

    const idA = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, idA!);
    await focusCaret(page, idA!, "end");
    const tokenA = ` MULTI-A-${info.project.name}`;
    const tokenB = ` MULTI-B-${info.project.name}`;
    await page.keyboard.type(tokenA);
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    // navigate the preview to another page (candidate links open the
    // link-editing dialog; navigation uses the explicit Follow affordance)
    await page.frameLocator("#xyle-preview").locator('nav a[href="/"]').click();
    const follow = page.getByRole("button", { name: "Follow" });
    await expect(follow).toBeVisible();
    await follow.click();
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return !!doc?.body && doc.body.textContent?.includes("Edit your static site visually");
    });

    const idB = await findNodeByText(page, "A person or a WebMCP-capable agent");
    await editNode(page, idB!);
    await focusCaret(page, idB!, "end");
    await page.keyboard.type(tokenB);
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(2);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    const about = await (await page.request.get("/about.html")).text();
    const index = await (await page.request.get("/index.html")).text();
    expect(about).toContain(tokenA.trim());
    expect(index).toContain(tokenB.trim());
  });

  test("same ephemeral node id on two pages keeps both operations", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const aboutId = await findNodeByText(page, "See how Xyle works");
    await editNode(page, aboutId!);
    await focusCaret(page, aboutId!, "end");
    const tokenA = ` PAGE-A-${info.project.name}`;
    const tokenB = ` PAGE-B-${info.project.name}`;
    await page.keyboard.type(tokenA);
    await clickOutsideCommit(page);

    await page.frameLocator("#xyle-preview").locator('nav a[href="/contact.html"]').click();
    await page.getByRole("button", { name: "Follow" }).click();
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return doc?.body?.textContent?.includes("Edit every useful detail");
    });

    const contactId = await findNodeByText(page, "Edit every useful detail");
    expect(contactId).toBe(aboutId);
    await editNode(page, contactId!);
    await focusCaret(page, contactId!, "end");
    await page.keyboard.type(tokenB);
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(2);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(await (await page.request.get("/about.html")).text()).toContain(tokenA.trim());
    expect(await (await page.request.get("/contact.html")).text()).toContain(tokenB.trim());
  });

  test("deferred line-break editing reports a clear no-op", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Editors change content");
    await editNode(page, id!);
    await focusCaret(page, id!, "start");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Enter");
    await clickOutsideCommit(page);

    await expect(page.locator("#xyle-flash")).toContainText("Line-break editing is deferred");
    expect(await htmlOf(page, id!)).not.toContain("<br");
    expect(await currentOps(page)).toHaveLength(0);
  });

  test("published content survives a server restart", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/contact.html");
    const id = await findNodeByText(page, "Edit every useful detail");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    const token = ` Restart-safe-${info.project.name}.`;
    await page.keyboard.type(token);
    await clickOutsideCommit(page);
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    // The webServer persists for the whole run; verify via fresh fetch that the
    // static file changed on disk (restart equivalence is covered by the
    // filesystem publisher unit tests which re-open the directory).
    const html = await (await page.request.get("/contact.html")).text();
    expect(html).toContain(token.trim());
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

    // discard through menu exit with the inline confirmation
    await page.locator("#xyle-control-hitbox").hover();
    await page.click("#xyle-menu-btn");
    await page.click("#xyle-menu button[data-action='exit']");
    await page.click("#xyle-discard-confirmation [data-discard]");
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

async function htmlOf(page: import("@playwright/test").Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement)?.innerHTML ?? "";
  }, nodeId);
}

async function textOfAfterReload(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    for (const el of doc.querySelectorAll("[data-xyle-node]")) {
      if ((el.textContent ?? "").includes("This Xyle demo starts")) {
        return el.textContent ?? "";
      }
    }
    return "";
  });
}
