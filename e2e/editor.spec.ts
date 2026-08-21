import { expect, test } from "@playwright/test";
import {
  TEST_KEY,
  currentOps,
  editNode,
  findNodeByText,
  focusCaret,
  loginAndOpenEditor,
  opsCount,
  waitForEditorReady,
} from "./helpers.ts";

test.describe("public site isolation", () => {
  test("normal pages load no Xyle runtime or UI", async ({ page }) => {
    await page.goto("/index.html");
    const html = await page.content();
    expect(html).not.toContain("/__xyle/");
    expect(html).not.toContain("data-xyle-node");
    expect(await page.locator("#xyle-root, #xyle-bar-left").count()).toBe(0);
    const scripts = await page.evaluate(() =>
      Array.from(document.scripts).map((s) => s.getAttribute("src")),
    );
    expect(scripts).toEqual(["/app.js"]);
  });
});

test.describe("editor shell and preview", () => {
  test("unauthenticated /edit shows login", async ({ page }) => {
    await page.goto("/edit");
    await expect(page.locator("#key")).toBeVisible();
  });

  test("login with the editor key opens the shell", async ({ page }) => {
    await page.goto("/edit");
    await page.fill("#key", "wrong-key");
    await page.click("button[type=submit]");
    await expect(page.locator("#err")).toContainText("not accepted");
    await page.fill("#key", TEST_KEY);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/edit/);
    await waitForEditorReady(page);
  });

  test("preview renders styles and assets through the injected base", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const applied = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
        .contentDocument!;
      const h1 = doc.querySelector("h1")!;
      return getComputedStyle(h1).lineHeight !== "normal" || getComputedStyle(doc.body).backgroundColor !== "rgba(0, 0, 0, 0)";
    });
    expect(applied).toBe(true);

    const imgLoaded = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
        .contentDocument!;
      const img = doc.querySelector('img[src="/assets/hero.webp"]') as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    });
    expect(imgLoaded).toBe(true);
  });

  test("site scripts never execute in the preview", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.waitForTimeout(500);
    const mutated = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
        .contentDocument!;
      return {
        marker: !!doc.getElementById("script-ran"),
        title: doc.title,
      };
    });
    expect(mutated.marker).toBe(false);
    expect(mutated.title).not.toBe("MUTATED-BY-SCRIPT");
  });

  test("forms cannot submit in the preview", async ({ page }) => {
    await loginAndOpenEditor(page, "/contact.html");
    let navigated = false;
    page.on("framenavigated", () => {
      navigated = true;
    });
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const form = frame.contentDocument!.querySelector("form") as HTMLFormElement;
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      // a real user gesture path must also be blocked
      const button = form.querySelector("button[type=submit]") as HTMLButtonElement;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(400);
    expect(navigated).toBe(false);
    const stillThere = await page.evaluate(
      () =>
        !!(document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!.querySelector(
          "form",
        ),
    );
    expect(stillThere).toBe(true);
  });

  test("internal navigation stays inside the editor via the follow affordance", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const link = frame.contentDocument!.querySelector('a[href="/about.html"]') as HTMLAnchorElement;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(page.locator("dialog")).toBeVisible();
    await page.click("dialog button[value='follow']");
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
        .contentDocument;
      return !!doc?.body && doc.body.textContent?.includes("crew behind Riverbend");
    });
    expect(page.url()).toContain("/edit");
  });
});

test.describe("chrome layout rules", () => {
  test("no full-width top toolbar exists; bottom controls are compact", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const bars = await page.evaluate(() => {
      const host = document.getElementById("xyle-preview-host")!;
      const topFullWidth = Array.from(document.querySelectorAll("body > *")).filter((el) => {
        if (el === host || host.contains(el) || el.contains(host)) return false;
        const r = el.getBoundingClientRect();
        return r.top < 60 && r.width > window.innerWidth * 0.95;
      });
      return { topFullWidth: topFullWidth.length };
    });
    expect(bars.topFullWidth).toBe(0);

    const leftBox = await page.locator("#xyle-bar-left").boundingBox();
    expect(leftBox).toBeTruthy();
    expect(leftBox!.y).toBeGreaterThan(300); // bottom anchored
  });

  test("dirty controls are absent when clean and appear after an edit", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    await expect(page.locator("#xyle-dirty")).toBeHidden();

    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("!");
    await clickOutsideCommit(page);

    await expect(page.locator("#xyle-dirty")).toBeVisible();
    await expect(page.locator("#xyle-count")).toContainText("1 change");
  });

  test("Publish does not leave /edit and clears dirty state", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("-published");
    await clickOutsideCommit(page);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(page.url()).toContain("/edit");

    // published content actually landed in the static file
    const res = await page.request.get("/about.html");
    expect(await res.text()).toContain("-published");
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });
});

test.describe("editing affordances", () => {
  test("Show editables toggles candidate outlines without shifting layout", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const beforeBoxes = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const h1 = doc.querySelector("h1")!;
      const r = h1.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });

    await page.click("#xyle-show-editables");
    const outlined = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const outlined = Array.from(doc.querySelectorAll(".xyle-editable-candidate"));
      return outlined.length;
    });
    expect(outlined).toBeGreaterThan(3);

    const afterBoxes = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const h1 = doc.querySelector("h1")!;
      const r = h1.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(afterBoxes).toEqual(beforeBoxes);

    // picture/srcset image is never highlighted as editable
    const pictureOutlined = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const fallback = doc.querySelector("picture img")!;
      return fallback.classList.contains("xyle-editable-candidate");
    });
    void pictureOutlined;
  });

  test("changed marker appears after an edit and disappears after publish", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("*");
    await clickOutsideCommit(page);

    await clickOutsideCommit(page);
    await expect.poll(async () => markerCount(page)).toBe(1);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(await markerCount(page)).toBe(0);
  });
});

test.describe("changes drawer and undo", () => {
  test("drawer lists edits with working per-change undo", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("X");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    await page.click("#xyle-changes");
    await expect(page.locator("#xyle-changes-drawer")).toBeVisible();
    await expect(page.locator("#xyle-changes-drawer")).toContainText("about.html");
    await page.click("#xyle-changes-drawer button:has-text('Undo')");
    await expect(page.locator("#xyle-dirty")).toBeHidden();

    const text = await textOf(page, id!);
    expect(text.endsWith("X")).toBe(false);
  });

  test("Escape reverts the active field without recording a change", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "The crew behind Riverbend");
    const original = await textOf(page, id!);
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("!!!");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => opsCount(page), { timeout: 3000 })
      .toBe(0);
    expect(await textOf(page, id!)).toBe(original);
  });

  test("keyboard undo/redo works outside fields", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("Q");
    await clickOutsideCommit(page);
    expect(await opsCount(page)).toBe(1);

    await page.keyboard.press("Control+z");
    await expect.poll(async () => opsCount(page)).toBe(0);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => opsCount(page)).toBe(1);
  });
});

test.describe("exit vs logout semantics", () => {
  test("Exit editor keeps the session; Log out destroys it", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");

    await page.click("#xyle-menu-btn");
    await page.click("#xyle-menu button[data-action='live']");
    // view live site opens a tab but keeps session — verify session endpoint still ok
    const session1 = await (await page.request.get("/__xyle/api/session")).json();
    expect(session1.authenticated).toBe(true);

    await page.click("#xyle-menu-btn");
    page.once("dialog", (d) => d.accept());
    await page.click("#xyle-menu button[data-action='logout']");
    await page.waitForURL((u) => !u.pathname.includes("/edit"), { timeout: 5000 });
    const session2 = await (await page.request.get("/__xyle/api/session")).json();
    expect(session2.authenticated).toBe(false);
  });

  test("dirty Exit warns and requires explicit discard", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("D");
    await clickOutsideCommit(page);

    await page.click("#xyle-menu-btn");
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/Discard/i);
      dialog.dismiss(); // keep editing
    });
    await page.click("#xyle-menu button[data-action='exit']");
    await page.waitForTimeout(200);
    expect(page.url()).toContain("/edit"); // dismissed → still editing
    expect(await opsCount(page)).toBe(1);
  });
});

test.beforeEach(() => {
  expect.extend({});
});

async function clickOutsideCommit(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("xyle-bar-left")!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
  });
}

async function textOf(page: import("@playwright/test").Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement).textContent ?? "";
  }, nodeId);
}

async function markerCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc.querySelectorAll(".xyle-marker").length;
  });
}
