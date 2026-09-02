import { expect, test } from "@playwright/test";
import {
  TEST_KEY,
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
    await expect(page.locator("#login-error")).toContainText("not accepted");
    await page.fill("#key", TEST_KEY);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/edit/);
    await waitForEditorReady(page);
  });

  test("preview renders styles and assets through the injected base", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const applied = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const h1 = doc.querySelector("h1")!;
      return (
        getComputedStyle(h1).lineHeight !== "normal" ||
        getComputedStyle(doc.body).backgroundColor !== "rgba(0, 0, 0, 0)"
      );
    });
    expect(applied).toBe(true);

    const imgLoaded = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const img = doc.querySelector('img[src="/assets/hero-fallback.jpg"]') as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    });
    expect(imgLoaded).toBe(true);
  });

  test("site scripts never execute in the preview", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.waitForTimeout(500);
    const mutated = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
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
    await page.frameLocator("#xyle-preview").locator("form button[type=submit]").click();
    await page.waitForTimeout(400);
    expect(navigated).toBe(false);
    const stillThere = await page.evaluate(
      () =>
        !!(
          document.querySelector("#xyle-preview") as HTMLIFrameElement
        ).contentDocument!.querySelector("form"),
    );
    expect(stillThere).toBe(true);
  });

  test("internal navigation stays inside the editor via the follow affordance", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.frameLocator("#xyle-preview").locator('nav a[href="/about.html"]').click();
    const follow = page.getByRole("button", { name: "Follow" });
    await expect(follow).toBeVisible();
    await follow.click();
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return !!doc?.body && doc.body.textContent?.includes("crew behind Riverbend");
    });
    expect(page.url()).toContain("/edit");
  });

  test("context tools stay anchored to the preview target", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.frameLocator("#xyle-preview").locator("a.cta").hover();
    const geometry = await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument?.querySelector("a.cta") as HTMLElement;
      const tools = document.querySelector("#xyle-overlay-root .xyle-link-tools") as HTMLElement;
      const frameRect = frame.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const toolsRect = tools.getBoundingClientRect();
      return {
        target: {
          left: frameRect.left + targetRect.left,
          top: frameRect.top + targetRect.top,
          right: frameRect.left + targetRect.right,
          bottom: frameRect.top + targetRect.bottom,
        },
        tools: toolsRect.toJSON(),
      };
    });
    expect(geometry.tools.width).toBeGreaterThan(0);
    expect(geometry.tools.height).toBeGreaterThan(0);
    const below = Math.abs(geometry.tools.top - (geometry.target.bottom + 6));
    const above = Math.abs(geometry.tools.bottom - (geometry.target.top - 6));
    const right = Math.abs(geometry.tools.left - (geometry.target.right + 8));
    const left = Math.abs(geometry.tools.right - (geometry.target.left - 8));
    expect(Math.min(below, above, right, left)).toBeLessThanOrEqual(8);
  });

  test("context tools dismiss when the pointer leaves a link", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.frameLocator("#xyle-preview").locator("a.cta").hover();
    await expect(page.locator(".xyle-link-tools")).toBeVisible();
    await page.frameLocator("#xyle-preview").locator("h1").hover();
    await expect(page.locator(".xyle-link-tools")).toHaveCount(0);
  });

  test("context tools dismiss when the editor shell or preview is clicked", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.frameLocator("#xyle-preview").locator("a.cta").click();
    await expect(page.locator(".xyle-link-tools")).toBeVisible();

    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-editables").click();
    await expect(page.locator(".xyle-link-tools")).toHaveCount(0);

    await page.frameLocator("#xyle-preview").locator("a.cta").click();
    await page
      .frameLocator("#xyle-preview")
      .locator("h1")
      .click({ position: { x: 2, y: 2 } });
    await expect(page.locator(".xyle-link-tools")).toHaveCount(0);
  });
});

test.describe("chrome layout rules", () => {
  test("preview remains the website viewport", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const box = await page.locator("#xyle-preview").boundingBox();
    expect(box).toBeTruthy();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(viewport.width * 0.95);
    expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
  });

  test("editor controls are small and unobtrusive", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await expect(page.locator("#xyle-control-dock")).toBeVisible();
    await expect(page.locator("#xyle-menu-btn")).toHaveAttribute("aria-label", /menu/i);
    const box = await page.locator("#xyle-control-dock").boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThan(220);
  });

  test("Xyle menu closes when the preview is clicked", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-menu-btn").click();
    await expect(page.locator("#xyle-menu")).toBeVisible();
    await page
      .frameLocator("#xyle-preview")
      .locator("h1")
      .click({ position: { x: 2, y: 2 } });
    await expect(page.locator("#xyle-menu")).toBeHidden();
  });

  test("touch users can reach the clean dock without hover", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL as string,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const touchPage = await context.newPage();
    await loginAndOpenEditor(touchPage, "/index.html");
    await expect(touchPage.locator("#xyle-menu-btn")).toBeInViewport();
    await touchPage.locator("#xyle-editables").tap();
    const editables = touchPage.locator("#xyle-editables");
    await expect(editables).toHaveAttribute("aria-pressed", "true");
    await expect(editables).toHaveAttribute("aria-label", "Hide editables");
    await expect(editables).toHaveAttribute("data-tooltip", "Hide editables");
    await context.close();
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
    await expect(page.locator("#xyle-count")).toHaveText("1");
    await expect(page.locator("#xyle-changes")).toHaveAttribute("aria-label", "Open 1 change");
  });

  test("Publish does not leave /edit and clears dirty state", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    const token = `-published-${info.project.name}`;
    await page.keyboard.type(token);
    await clickOutsideCommit(page);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(page.url()).toContain("/edit");

    // published content actually landed in the static file
    const res = await page.request.get("/about.html");
    expect(await res.text()).toContain(token);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("inline strong editing publishes safely or fails closed", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const beforeSource = await (await page.request.get("/index.html")).text();
    const id = await findNodeByText(page, "We are a");
    await editNode(page, id!);
    await page.evaluate((nodeId) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      const win = frame.contentWindow!;
      const strong = doc.querySelector(`[data-xyle-node="${nodeId}"] strong`)!;
      const range = doc.createRange();
      range.selectNodeContents(strong);
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, id);
    const token = `locally-owned-${info.project.name}`;
    await page.keyboard.type(token);
    await clickOutsideCommit(page);
    if ((await opsCount(page)) === 0) {
      expect(await (await page.request.get("/index.html")).text()).toBe(beforeSource);
      return;
    }
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    const html = await (await page.request.get("/index.html")).text();
    expect(html).toContain(`<strong>${token}</strong>`);
    expect(html).toContain("company with");
    expect(html).toContain("<em>twenty-eight years</em>");
    expect(html).toContain("behind the wrench.");
  });

  test("authored br segments publish separately", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const beforeSource = await (await page.request.get("/index.html")).text();
    const id = await findNodeByText(page, "Serving Edmonton");
    await editNode(page, id!);
    await page.evaluate((nodeId) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      const win = frame.contentWindow!;
      const el = doc.querySelector(`[data-xyle-node="${nodeId}"]`)!;
      const directText = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      const last = directText.at(-1)!;
      (el as HTMLElement).focus();
      const range = doc.createRange();
      range.selectNodeContents(last);
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, id);
    const token = `the authored break ${info.project.name}`;
    await page.keyboard.type(token);
    await clickOutsideCommit(page);
    await expect.poll(() => opsCount(page)).toBe(1);
    expect(await (await page.request.get("/index.html")).text()).toBe(beforeSource);
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    const html = await (await page.request.get("/index.html")).text();
    const lede = html.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(lede).toContain("Serving Edmonton and surrounding areas");
    expect(lede).toContain(token);
    expect(lede.match(/<br\s*\/?\s*>/g)).toHaveLength(2);
  });

  test("undo after publish returns to the new published baseline", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    let id = await findNodeByText(page, "Riverbend Plumbing started");
    const publishedToken = ` baseline-${info.project.name}`;
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(publishedToken);
    await clickOutsideCommit(page);
    const previewBeforePublish = await page.locator("#xyle-preview").elementHandle();
    if (!previewBeforePublish) throw new Error("Editable preview is unavailable before publish");
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.waitForFunction(
      (oldPreview) => document.querySelector("#xyle-preview") !== oldPreview,
      previewBeforePublish,
    );

    await page.waitForFunction((expected) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return Boolean(
        document.getElementById("xyle-overlay-root") && doc?.body?.textContent?.includes(expected),
      );
    }, publishedToken.trim());
    id = await findNodeByText(page, "Riverbend Plumbing started");
    const draftToken = ` draft-${info.project.name}`;
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(draftToken);
    await clickOutsideCommit(page);
    await page.keyboard.press("Control+z");
    const text = await textOf(page, id!);
    expect(text).toContain(publishedToken.trim());
    expect(text).not.toContain(draftToken.trim());
  });
});

test.describe("editing affordances", () => {
  test("Show editables and hover expose visible non-layout outlines", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const heading = page.frameLocator("#xyle-preview").locator("h1");
    const before = await heading.boundingBox();

    await page.click("#xyle-editables");
    await expect(page.locator("#xyle-editables")).toHaveAttribute("aria-pressed", "true");
    const shownOutline = await heading.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(shownOutline).not.toBe("rgba(0, 0, 0, 0)");

    await page.click("#xyle-editables");
    await heading.hover();
    const hoverOutline = await heading.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(hoverOutline).not.toBe("rgba(0, 0, 0, 0)");
    expect(await heading.boundingBox()).toEqual(before);
  });

  test("link Edit text changes only the label", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    const originalHref = await link.getAttribute("href");
    await link.click();
    await page.getByRole("button", { name: "Edit text" }).click();
    await expect(page.locator("dialog")).toHaveCount(0);
    await page.keyboard.press("Control+A");
    const label = `Quote ${info.project.name}`;
    await page.keyboard.type(label);
    await clickOutsideCommit(page);

    await expect(link).toHaveAttribute("href", originalHref!);
    await expect(link).toHaveText(label);
    await expect(page.locator(".xyle-img-tools")).toHaveCount(0);
    const ops = await page.evaluate(
      () =>
        (window as unknown as { __xyle?: { ops: Array<{ op: { type: string } }> } }).__xyle?.ops ??
        [],
    );
    expect(ops.map((entry) => entry.op.type)).toEqual(["text"]);
  });

  test("link Edit URL changes only the destination", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    const originalLabel = await link.textContent();
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    await expect(panel).toBeVisible();
    const destination = `/about.html?from=${info.project.name}`;
    await panel.locator("input[name=href]").fill(destination);
    await panel.getByRole("button", { name: "Save" }).click();

    await expect(link).toHaveText(originalLabel ?? "");
    await expect(link).toHaveAttribute("href", destination);
    await expect(page.locator(".xyle-img-tools")).toHaveCount(0);
    const ops = await page.evaluate(
      () =>
        (window as unknown as { __xyle?: { ops: Array<{ op: { type: string } }> } }).__xyle?.ops ??
        [],
    );
    expect(ops.map((entry) => entry.op.type)).toEqual(["href"]);
  });

  test("inline editor keeps ownership across real pointer and focus transfer", async ({
    page,
  }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();

    const panel = page.locator(".xyle-link-tools");
    const input = panel.locator("input[name=href]");
    await input.focus();
    await input.fill(`/about.html?pointer=${info.project.name}`);
    await panel.getByRole("button", { name: "Save" }).hover();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(link).toHaveAttribute("href", `/about.html?pointer=${info.project.name}`);
  });

  test("link panel can cancel after rejecting an invalid destination", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    const input = panel.locator("input[name=href]");
    await input.fill("javascript:alert(1)");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await panel.getByRole("button", { name: "Cancel" }).click();
    const editUrl = page.locator(".xyle-link-tools").getByRole("button", { name: "Edit URL" });
    await expect(editUrl).toBeVisible();
    await expect(editUrl).toBeFocused();
    await expect(page.locator(".xyle-link-tools input[name=href]")).toHaveCount(0);
  });

  test("changed marker appears after an edit and disappears after publish", async ({
    page,
  }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(` marker-${info.project.name}`);
    await clickOutsideCommit(page);

    await page
      .frameLocator("#xyle-preview")
      .locator(`[data-xyle-node="${id}"]`)
      .scrollIntoViewIfNeeded();
    const geometry = await markerGeometry(page, id!);
    expect(geometry.visible).toBe(true);
    expect(geometry.markerX).toBeGreaterThanOrEqual(geometry.targetRight);
    expect(Math.abs(geometry.markerY - geometry.targetTop)).toBeLessThan(16);
    expect(geometry.markerRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.markerBottom).toBeLessThanOrEqual(geometry.viewportHeight);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect(await visibleMarkerCount(page)).toBe(0);
  });
});

test.describe("changes drawer and undo", () => {
  test("drawer renders edited markup as inert text (no shell XSS)", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    // simulate hostile content arriving via paste
    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const target = frame.contentDocument!.querySelector(".xyle-editing")!;
      const dt = new DataTransfer();
      dt.setData("text/plain", '<img src=x onerror="window.__xylePwned=1">');
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: dt });
      target.dispatchEvent(event);
    });
    await clickOutsideCommit(page);

    await page.click("#xyle-changes");
    await page.waitForTimeout(200);
    const pwned = await page.evaluate(
      () => (window as unknown as { __xylePwned?: boolean }).__xylePwned,
    );
    expect(pwned).toBeUndefined();
    const injectedImages = await page.evaluate(
      () => document.querySelectorAll("#xyle-changes-drawer img").length,
    );
    expect(injectedImages).toBe(0);
  });

  test("groups changes by page and shows human before and after values", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    const originalText = (await link.textContent()) ?? "";
    const originalHref = (await link.getAttribute("href")) ?? "";
    const updatedText = "Request a grouped quote";
    const updatedHref = "/contact.html?from=changes";

    await link.click();
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(updatedText);
    await clickOutsideCommit(page);
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    await panel.locator("input[name=href]").fill(updatedHref);
    await panel.getByRole("button", { name: "Save" }).click();

    await page.frameLocator("#xyle-preview").locator('nav a[href="/about.html"]').click();
    await page.getByRole("button", { name: "Follow" }).click();
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      return doc?.body?.textContent?.includes("Riverbend Plumbing started");
    });
    const aboutId = await findNodeByText(page, "Riverbend Plumbing started");
    const originalAboutText = await textOf(page, aboutId!);
    await editNode(page, aboutId!);
    await focusCaret(page, aboutId!, "end");
    await page.keyboard.type(" GROUPED-ABOUT");
    await clickOutsideCommit(page);

    await page.click("#xyle-changes");
    const drawer = page.getByRole("dialog", { name: "Changes" });
    const groups = drawer.locator(".xyle-change-page-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.locator(".xyle-change-page")).toHaveText(["/index.html", "/about.html"]);
    const indexGroup = groups.nth(0);
    const aboutGroup = groups.nth(1);
    const textRow = indexGroup.locator(".xyle-change-row").nth(0);
    const linkRow = indexGroup.locator(".xyle-change-row").nth(1);
    await expect(textRow.locator(".xyle-change-type")).toHaveText("Text");
    await expect(linkRow.locator(".xyle-change-type")).toHaveText("Link");
    await expect(textRow.locator(".xyle-change-before")).toContainText(originalText);
    await expect(textRow.locator(".xyle-change-after")).toContainText(updatedText);
    await expect(linkRow.locator(".xyle-change-before")).toContainText(originalHref);
    await expect(linkRow.locator(".xyle-change-after")).toContainText(updatedHref);
    await expect(indexGroup.locator(".xyle-change-arrow")).toHaveCount(2);
    await expect(aboutGroup.locator(".xyle-change-before")).toContainText(originalAboutText);
    await expect(aboutGroup.locator(".xyle-change-after")).toContainText("GROUPED-ABOUT");
  });

  test("Changes drawer preserves exact whitespace in reviewed values", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("  exact spaces  ");
    await clickOutsideCommit(page);

    await page.locator("#xyle-changes").click();
    const row = page.locator("#xyle-changes-drawer .xyle-change-row").first();
    const after = await row.locator(".xyle-change-after").textContent();
    expect(after).toContain("&nbsp; exact spaces&nbsp; ");
  });

  test("mobile Changes drawer traps focus and Escape restores its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" MOBILE-DRAWER");
    await clickOutsideCommit(page);

    const trigger = page.locator("#xyle-changes");
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Changes" });
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    const close = drawer.getByRole("button", { name: "Close changes drawer" });
    const discard = drawer.getByRole("button", { name: "Discard all changes" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(discard).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    const geometry = await drawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

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
    const row = page.locator("#xyle-changes-drawer .xyle-change-row").first();
    await row.getByRole("button", { name: "Locate" }).click();
    await expect(row).toHaveClass(/is-located/);
    await expect(page.locator("#xyle-changes-drawer")).toBeVisible();
    await expect(page.locator("#xyle-overlay-root .xyle-editable-outline.is-active")).toHaveCount(
      1,
    );
    await page.click("#xyle-changes-drawer button:has-text('Revert')");
    await expect(page.locator("#xyle-changes-drawer")).toBeVisible();
    await expect(page.locator("#xyle-changes-drawer .xyle-change-row")).toHaveCount(0);
    await expect(page.locator("#xyle-changes-count")).toHaveText("");
    await expect(page.locator("#xyle-dirty")).toBeHidden();

    const text = await textOf(page, id!);
    expect(text.endsWith("X")).toBe(false);
  });

  test("Changes drawer can discard the whole draft and reload published content", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    const original = await textOf(page, id!);
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" THROW-AWAY");
    await clickOutsideCommit(page);

    await page.click("#xyle-changes");
    await page.click("#xyle-discard");
    await page.click("#xyle-discard-confirmation [data-discard]");
    await expect(page.locator("#xyle-dirty")).toBeHidden();
    await page.waitForFunction(
      ({ nodeId, expected }) => {
        const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
        return doc?.querySelector(`[data-xyle-node="${nodeId}"]`)?.textContent === expected;
      },
      { nodeId: id, expected: original },
    );
    expect(await textOf(page, id!)).toBe(original);
  });

  test("Escape reverts the active field without recording a change", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "The crew behind Riverbend");
    const original = await textOf(page, id!);
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("!!!");
    await page.keyboard.press("Escape");
    await expect.poll(async () => opsCount(page), { timeout: 3000 }).toBe(0);
    expect(await textOf(page, id!)).toBe(original);
  });

  test("keyboard undo/redo works outside fields", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "Riverbend Plumbing started");
    const original = await textOf(page, id!);

    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("Q");
    await clickOutsideCommit(page);
    const firstEdit = await textOf(page, id!);

    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("R");
    await clickOutsideCommit(page);
    const secondEdit = await textOf(page, id!);
    expect(await opsCount(page)).toBe(1);

    await page.keyboard.press("Control+z");
    expect(await textOf(page, id!)).toBe(firstEdit);
    expect(await opsCount(page)).toBe(1);
    await page.keyboard.press("Control+z");
    expect(await textOf(page, id!)).toBe(original);
    expect(await opsCount(page)).toBe(0);
    await page.keyboard.press("Control+Shift+z");
    expect(await textOf(page, id!)).toBe(firstEdit);
    await page.keyboard.press("Control+Shift+z");
    expect(await textOf(page, id!)).toBe(secondEdit);
    expect(await opsCount(page)).toBe(1);
  });
  test("groups selected sibling blocks from the human editor", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const firstId = await findNodeByText(page, "The first Riverbend jobs");
    const secondId = await findNodeByText(page, "We keep appointments realistic");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    await editNode(page, firstId!);
    await page.evaluate((id) => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      const el = doc.querySelector(`[data-xyle-node="${id}"]`)!;
      const selection = doc.getSelection()!;
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new Event("selectionchange"));
    }, firstId);
    const blockStyle = page.locator('.xyle-format-tools select[aria-label="Block style"]');
    await expect(blockStyle).toBeVisible();
    await blockStyle.selectOption("unordered-list");
    await expect
      .poll(async () =>
        page
          .frameLocator("#xyle-preview")
          .locator(`[data-xyle-node="${firstId}"]`)
          .evaluate((element) => element.parentElement?.tagName),
      )
      .toBe("UL");
    await expect
      .poll(async () =>
        page
          .frameLocator("#xyle-preview")
          .locator(`[data-xyle-node="${secondId}"]`)
          .evaluate((element) => element.tagName),
      )
      .toBe("LI");
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument
            ?.getSelection()
            ?.toString(),
        ),
      )
      .toContain("The first Riverbend jobs");
  });

  test("updates SEO metadata from the human editor", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-menu-btn").click();
    await page.locator('#xyle-menu button[data-action="seo"]').click();
    const panel = page.getByRole("dialog", { name: "SEO metadata" });
    await expect(panel).toBeVisible();
    await panel.locator('[name="title"]').fill("Updated page title");
    await panel.getByRole("button", { name: "Save metadata" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.title,
        ),
      )
      .toBe("Updated page title");
  });
});

test.describe("exit vs logout semantics", () => {
  test("Exit editor keeps the session; Log out destroys it", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");

    await page.locator("#xyle-control-hitbox").hover();
    await page.click("#xyle-menu-btn");
    await page.click("#xyle-menu button[data-action='live']");
    // view live site opens a tab but keeps session — verify session endpoint still ok
    const session1 = await (await page.request.get("/__xyle/api/session")).json();
    expect(session1.authenticated).toBe(true);

    await page.locator("#xyle-control-hitbox").hover();
    await page.click("#xyle-menu-btn");
    page.once("dialog", (d) => d.accept());
    await page.click("#xyle-menu button[data-action='logout']");
    await page.waitForURL((url) => url.pathname === "/edit", { timeout: 5000 });
    await expect(page.getByRole("heading", { name: "Open your site editor" })).toBeVisible();
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

    await page.locator("#xyle-control-hitbox").hover();
    await page.click("#xyle-menu-btn");
    await page.click("#xyle-menu button[data-action='exit']");
    await page.click("#xyle-discard-confirmation [data-keep]");
    await page.waitForTimeout(200);
    expect(page.url()).toContain("/edit"); // dismissed → still editing
    expect(await opsCount(page)).toBe(1);
  });
});

test.beforeEach(() => {
  expect.extend({});
});

async function clickOutsideCommit(page: import("@playwright/test").Page): Promise<void> {
  await page
    .frameLocator("#xyle-preview")
    .locator("html")
    .click({ position: { x: 1, y: 1 } });
}

async function textOf(page: import("@playwright/test").Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return (doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement).textContent ?? "";
  }, nodeId);
}

async function visibleMarkerCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    return [...document.querySelectorAll("#xyle-overlay-root .xyle-marker")].filter((marker) => {
      const rect = marker.getBoundingClientRect();
      return getComputedStyle(marker).display !== "none" && rect.width > 0;
    }).length;
  });
}

test("hides and reorders safe sibling sections", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  const sectionIds = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll("section[data-xyle-node]")].map((section) =>
      section.getAttribute("data-xyle-node"),
    );
  });
  expect(sectionIds.length).toBeGreaterThanOrEqual(2);
  const first = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${sectionIds[0]}"]`);
  await first.click({ position: { x: 2, y: 2 } });
  await expect(page.locator(".xyle-section-tools")).toBeVisible();
  await page.getByRole("button", { name: "Move down" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
        return [...doc.querySelectorAll("main > section")].map((section) =>
          section.getAttribute("data-xyle-node"),
        );
      }),
    )
    .toEqual([sectionIds[1], sectionIds[0], ...sectionIds.slice(2)]);

  await page.locator("#xyle-changes").click();
  await page.locator("#xyle-changes-drawer .xyle-undo-button").first().click();
  await page.locator("#xyle-changes-close").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
        return [...doc.querySelectorAll("main > section")].map((section) =>
          section.getAttribute("data-xyle-node"),
        );
      }),
    )
    .toEqual(sectionIds);

  await first.click({ position: { x: 2, y: 2 } });
  await page.getByRole("button", { name: "Hide section" }).click();
  await expect(first).toHaveJSProperty("hidden", true);
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-menu-btn").click();
  await page.getByRole("menuitem", { name: "Sections" }).click();
  const sectionsDrawer = page.getByRole("dialog", { name: "Sections" });
  await expect(sectionsDrawer).toBeVisible();
  await sectionsDrawer.getByRole("button", { name: "Show" }).first().click();
  await expect(first).toHaveJSProperty("hidden", false);
});

async function markerGeometry(
  page: import("@playwright/test").Page,
  nodeId: string,
): Promise<{
  visible: boolean;
  markerX: number;
  markerY: number;
  markerRight: number;
  markerBottom: number;
  targetRight: number;
  targetTop: number;
  viewportWidth: number;
  viewportHeight: number;
}> {
  return page.evaluate((id) => {
    const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const frameRect = frame.getBoundingClientRect();
    const marker = document.querySelector("#xyle-overlay-root .xyle-marker") as HTMLElement | null;
    const target = doc.querySelector(`[data-xyle-node="${id}"]`) as HTMLElement;
    const markerRect = marker?.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return {
      visible: Boolean(
        marker && getComputedStyle(marker).display !== "none" && markerRect && markerRect.width > 0,
      ),
      markerX: markerRect?.left ?? -1,
      markerY: markerRect?.top ?? -1,
      markerRight: markerRect?.right ?? -1,
      markerBottom: markerRect?.bottom ?? -1,
      targetRight: frameRect.left + targetRect.right,
      targetTop: frameRect.top + targetRect.top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }, nodeId);
}
