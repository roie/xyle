import { expect, test } from "@playwright/test";
import {
  TEST_KEY,
  currentOps,
  editNode,
  findNodeByText,
  focusCaret,
  loginAndOpenEditor,
  opsCount,
  setSelection,
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

  test("demo contact form confirms that it sends nothing", async ({ page }) => {
    let submitted = false;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/demo-contact") submitted = true;
    });
    await page.goto("/contact.html");
    await page.locator("#name").fill("Demo visitor");
    await page.locator("#phone").fill("555-0100");
    await page.locator("#message").fill("Change the introduction.");
    await page.getByRole("button", { name: "Show demo response" }).click();

    await expect(page.locator("#demo-form-status")).toHaveText(
      "Demo complete. No information was sent.",
    );
    expect(submitted).toBe(false);
    expect(new URL(page.url()).pathname).toBe("/contact.html");
  });
});

test.describe("editor shell and preview", () => {
  test("unauthenticated /edit shows login", async ({ page }) => {
    await page.goto("/edit");
    await expect(page.locator("#key")).toBeVisible();
    await expect(page.locator('.xyle-logo img[src^="data:image/png;base64,"]')).toBeVisible();
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
    await expect(
      page.locator('#xyle-dock-handle img.xyle-brand-logo[src^="data:image/png;base64,"]'),
    ).toBeVisible();
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
    await loginAndOpenEditor(page, "/script-runtime.html");
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
      return !!doc?.body && doc.body.textContent?.includes("See how Xyle works");
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

  test("editable targets expose instructions and use arrow-key navigation", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const targets = page.frameLocator("#xyle-preview").locator("[data-xyle-keyboard-target]");
    const targetCount = await targets.count();
    expect(targetCount).toBeGreaterThan(1);

    const accessibility = await targets.evaluateAll((elements) => ({
      generatedTabbable: elements.filter(
        (element) =>
          element.hasAttribute("data-xyle-generated-tabindex") &&
          element.getAttribute("tabindex") === "0",
      ).length,
      described: elements.every((element) => Boolean(element.getAttribute("aria-description"))),
      shortcuts: elements.every((element) =>
        element.getAttribute("aria-keyshortcuts")?.includes("ArrowDown"),
      ),
    }));
    expect(accessibility).toEqual({ generatedTabbable: 1, described: true, shortcuts: true });

    const first = targets.nth(0);
    const second = targets.nth(1);
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await expect(first).toHaveAttribute("tabindex", "-1");
    await expect(second).toHaveAttribute("tabindex", "0");
  });

  test("arrow navigation preserves and includes authored tabindex targets", async ({ page }) => {
    await loginAndOpenEditor(page, "/qa-golden.html");
    const frame = page.frameLocator("#xyle-preview");
    const targets = frame.locator("[data-xyle-keyboard-target]");
    const heading = frame.locator('#qa-intro-title[tabindex="0"]');
    await expect(heading).toHaveAttribute("aria-keyshortcuts", /ArrowDown/);
    const headingIndex = await targets.evaluateAll(
      (elements, id) => elements.findIndex((element) => element.id === id),
      "qa-intro-title",
    );
    expect(headingIndex).toBeGreaterThanOrEqual(0);

    await heading.focus();
    await page.keyboard.press("ArrowDown");
    await expect(targets.nth((headingIndex + 1) % (await targets.count()))).toBeFocused();
    await expect(heading).toHaveAttribute("tabindex", "0");
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
    const menuItems = page.locator("#xyle-menu [role=menuitem]");
    await expect(menuItems.first().locator("svg")).toBeVisible();
    await expect(menuItems.last().locator("svg")).toBeVisible();
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
    const menuButton = touchPage.locator("#xyle-menu-btn");
    await expect(menuButton).toBeInViewport();
    const menuButtonBox = await menuButton.boundingBox();
    expect(menuButtonBox?.width).toBeGreaterThanOrEqual(43.9);
    expect(menuButtonBox?.height).toBeGreaterThanOrEqual(43.9);
    await touchPage.locator("#xyle-editables").tap();
    const editables = touchPage.locator("#xyle-editables");
    await expect(editables).toHaveAttribute("aria-pressed", "true");
    await expect(editables).toHaveAttribute("aria-label", "Hide editables");
    await expect(editables).toHaveAttribute("data-tooltip", "Hide editables");

    const image = touchPage
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.tap();
    const replace = touchPage.locator(".xyle-img-tools").getByRole("button", { name: "Replace" });
    const replaceBox = await replace.boundingBox();
    expect(replaceBox?.width).toBeGreaterThanOrEqual(43.9);
    expect(replaceBox?.height).toBeGreaterThanOrEqual(43.9);
    await touchPage.keyboard.press("Escape");

    await touchPage.locator("#xyle-structure-shortcut").tap();
    const drawerClose = touchPage.getByRole("button", { name: "Close outline" });
    const drawerCloseBox = await drawerClose.boundingBox();
    expect(drawerCloseBox?.width).toBeGreaterThanOrEqual(43.9);
    expect(drawerCloseBox?.height).toBeGreaterThanOrEqual(43.9);
    await expect(drawerClose).toBeFocused();
    await touchPage.keyboard.press("Shift+Tab");
    expect(
      await touchPage.evaluate(() =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement.getClientRects().length
          : 0,
      ),
    ).toBeGreaterThan(0);
    await touchPage.keyboard.press("Tab");
    await expect(drawerClose).toBeFocused();
    const firstArea = touchPage.locator(".xyle-outline-node").first();
    const disclosure = firstArea.locator(".xyle-outline-disclosure");
    const children = firstArea.locator(":scope > .xyle-outline-children");
    await expect(children).toBeHidden();
    await disclosure.focus();
    await touchPage.keyboard.press("Enter");
    await expect(children).toBeVisible();
    await expect(disclosure).toBeFocused();
    await expect(children.locator(".xyle-outline-child svg").first()).toBeVisible();
    await touchPage.keyboard.press("Space");
    await expect(children).toBeHidden();
    await expect(disclosure).toBeFocused();

    const menuTrigger = firstArea.locator(".xyle-outline-menu-trigger");
    await menuTrigger.tap();
    await touchPage.locator("[data-structure-list]").dispatchEvent("scroll");
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
    await menuTrigger.tap();
    await touchPage.setViewportSize({ width: 391, height: 844 });
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
    await menuTrigger.tap();
    await expect(menuTrigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(firstArea.getByRole("menu")).toBeVisible();
    const hideButton = firstArea.getByRole("menuitem", { name: "Hide", exact: true });
    const hideButtonBox = await hideButton.boundingBox();
    expect(hideButtonBox?.width).toBeGreaterThanOrEqual(43.9);
    expect(hideButtonBox?.height).toBeGreaterThanOrEqual(43.9);
    await firstArea.locator(".xyle-outline-select").tap();
    await expect(touchPage.getByRole("dialog", { name: "Outline" })).toHaveCount(0);
    await expect(touchPage.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await context.close();
  });

  test("panel shortcuts toggle one drawer at a time", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    const panels = [
      ["#xyle-media-shortcut", "Media"],
      ["#xyle-structure-shortcut", "Outline"],
      ["#xyle-seo-shortcut", "SEO metadata"],
    ] as const;

    for (const [shortcutSelector, panelName] of panels) {
      const shortcut = page.locator(shortcutSelector);
      await shortcut.click();
      await expect(page.getByRole("dialog", { name: panelName })).toBeVisible();
      await expect(shortcut).toHaveAttribute("aria-expanded", "true");
      await shortcut.click();
      await expect(page.getByRole("dialog", { name: panelName })).toHaveCount(0);
      await expect(shortcut).toHaveAttribute("aria-expanded", "false");
      await expect(shortcut).toBeFocused();
    }

    await page.locator("#xyle-media-shortcut").click();
    await page.locator("#xyle-seo-shortcut").click();
    await expect(page.getByRole("dialog", { name: "Media" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "SEO metadata" })).toBeVisible();
  });

  test("dock handle remains a full touch target at 320 pixels", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL as string,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 320, height: 640 },
    });
    try {
      const touchPage = await context.newPage();
      await loginAndOpenEditor(touchPage, "/index.html");
      const handle = touchPage.locator("#xyle-dock-handle");
      const handleBox = await handle.boundingBox();
      expect(handleBox?.width).toBeGreaterThanOrEqual(87.9);
      expect(handleBox?.height).toBeGreaterThanOrEqual(43.9);
      expect(handleBox?.x).toBeGreaterThanOrEqual(0);
      expect((handleBox?.x ?? 0) + (handleBox?.width ?? 0)).toBeLessThanOrEqual(320);
      const barBox = await touchPage.locator("#xyle-control-bar").boundingBox();
      expect(barBox?.x).toBeGreaterThanOrEqual(0);
      expect((barBox?.x ?? 0) + (barBox?.width ?? 0)).toBeLessThanOrEqual(320);
      await handle.tap();
      await expect(handle).toHaveAttribute("aria-expanded", "true");
    } finally {
      await context.close();
    }
  });

  test("dirty controls are absent when clean and appear after an edit", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    await expect(page.locator("#xyle-dirty")).toBeHidden();

    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("!");
    await clickOutsideCommit(page);

    await expect(page.locator("#xyle-dirty")).toBeVisible();
    await expect(page.locator("#xyle-count")).toHaveText("1");
    const changesShortcut = page.locator("#xyle-changes");
    await expect(changesShortcut).toHaveAttribute("aria-label", "Open 1 change");
    await changesShortcut.click();
    await expect(page.getByRole("dialog", { name: "Changes" })).toBeVisible();
    await expect(changesShortcut).toHaveAttribute("aria-expanded", "true");
    await changesShortcut.click();
    await expect(page.getByRole("dialog", { name: "Changes" })).toHaveCount(0);
    await expect(changesShortcut).toHaveAttribute("aria-expanded", "false");
  });

  test("Publish does not leave /edit and clears dirty state", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
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
    expect(html).toContain("with");
    expect(html).toContain("<em>one shared history</em>");
    expect(html).toContain("for each draft.");
  });

  test("authored br segments publish separately", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const beforeSource = await (await page.request.get("/index.html")).text();
    const id = await findNodeByText(page, "Change this page in place");
    const originalSegments = await page.evaluate((nodeId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const element = doc.querySelector(`[data-xyle-node="${nodeId}"]`)!;
      return [...element.childNodes]
        .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.data.trim());
    }, id);
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
    expect(await currentOps(page)).toEqual([
      {
        pagePath: "/index.html",
        op: { type: "text", nodeId: `${id}#2`, value: token },
      },
    ]);
    expect(await (await page.request.get("/index.html")).text()).toBe(beforeSource);
    await page.locator("#xyle-changes").click();
    const change = page
      .getByRole("dialog", { name: "Changes" })
      .locator(".xyle-change-row")
      .filter({ hasText: token });
    await expect(change.locator(".xyle-change-before")).toContainText(originalSegments[2]!);
    await expect(change.locator(".xyle-change-after")).toContainText(token);
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

    const html = await (await page.request.get("/index.html")).text();
    const lede = html.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? "";
    const publishedSegments = lede.split(/<br\s*\/?\s*>/).map((segment) => segment.trim());
    expect(publishedSegments).toEqual([
      "Change this page in place",
      "then review every pending edit",
      token,
    ]);
    expect(lede.match(/<br\s*\/?\s*>/g)).toHaveLength(2);
    expect(html).not.toContain("data-xyle-node");

    await page.goto("/index.html");
    const publicSegments = await page.locator("p.lede").evaluate((element) => ({
      text: [...element.childNodes]
        .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.data.trim()),
      breaks: element.querySelectorAll("br").length,
    }));
    expect(publicSegments).toEqual({
      text: ["Change this page in place", "then review every pending edit", token],
      breaks: 2,
    });
  });

  test("undo after publish returns to the new published baseline", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    let id = await findNodeByText(page, "This Xyle demo starts");
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
    id = await findNodeByText(page, "This Xyle demo starts");
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
    const originalLabel = (await link.textContent()) ?? "";
    const linkId = await link.getAttribute("data-xyle-node");
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
    expect(await currentOps(page)).toEqual([
      {
        pagePath: "/index.html",
        op: { type: "text", nodeId: `${linkId}#0`, value: label },
      },
    ]);
    await page.locator("#xyle-changes").click();
    const change = page
      .getByRole("dialog", { name: "Changes" })
      .locator(".xyle-change-row")
      .filter({ hasText: label });
    await expect(change.locator(".xyle-change-before")).toContainText(originalLabel);
    await expect(change.locator(".xyle-change-after")).toContainText(label);
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get("/index.html")).text();
    expect(source).toContain(`>${label}</a>`);
    expect(source).not.toContain("data-xyle-node");

    await page.goto("/index.html");
    const publishedLink = page.locator("a.cta");
    await expect(publishedLink).toHaveText(label);
    await expect(publishedLink).toHaveAttribute("href", originalHref!);
  });

  test("link Edit URL changes only the destination", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    const originalLabel = await link.textContent();
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Follow" })).toHaveCount(0);
    const hrefInput = panel.getByRole("textbox", { name: "Link destination" });
    await expect(hrefInput).toHaveAttribute("placeholder", "https://example.com or /about");
    const destination = `/about.html?from=${info.project.name}`;
    await hrefInput.fill(destination);
    await panel.getByRole("button", { name: "Save" }).click();
    await panel.getByRole("button", { name: "Edit URL" }).click();
    const finalDestination = `${destination}&reopened=1`;
    await panel.getByRole("textbox", { name: "Link destination" }).fill(finalDestination);
    await panel.getByRole("button", { name: "Save" }).click();

    await expect(link).toHaveText(originalLabel ?? "");
    await expect(link).toHaveAttribute("href", finalDestination);
    await expect(page.locator(".xyle-img-tools")).toHaveCount(0);
    const ops = await page.evaluate(
      () =>
        (window as unknown as { __xyle?: { ops: Array<{ op: { type: string } }> } }).__xyle?.ops ??
        [],
    );
    expect(ops.map((entry) => entry.op.type)).toEqual(["href"]);
  });

  test("link Edit URL treats a bare domain as an HTTPS destination", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    await panel.getByRole("textbox", { name: "Link destination" }).fill("google.com/search?q=xyle");
    await panel.getByRole("button", { name: "Save" }).click();

    await expect(link).toHaveAttribute("href", "https://google.com/search?q=xyle");
    expect(await currentOps(page)).toEqual([
      {
        pagePath: "/index.html",
        op: {
          type: "href",
          nodeId: await link.getAttribute("data-xyle-node"),
          value: "https://google.com/search?q=xyle",
        },
      },
    ]);
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
    const id = await findNodeByText(page, "This Xyle demo starts");
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
    const id = await findNodeByText(page, "This Xyle demo starts");
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
      return doc?.body?.textContent?.includes("This Xyle demo starts");
    });
    const aboutId = await findNodeByText(page, "This Xyle demo starts");
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
    await expect(aboutGroup.locator(".xyle-change-before")).toHaveAttribute(
      "aria-label",
      /Xyle demo starts with ordinary HTML and assets\./,
    );
    await expect(aboutGroup.locator(".xyle-change-after")).toContainText("GROUPED-ABOUT");

    await textRow.getByRole("button", { name: "Revert" }).click();
    await expect(drawer.locator(".xyle-change-row")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.locator("#xyle-changes")).toBeFocused();
  });

  test("Changes drawer preserves exact whitespace in reviewed values", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("  exact spaces  ");
    await clickOutsideCommit(page);

    await page.locator("#xyle-changes").click();
    const row = page.locator("#xyle-changes-drawer .xyle-change-row").first();
    const after = await row.locator(".xyle-change-after").textContent();
    expect(after).toContain("&nbsp; exact spaces&nbsp; ");
    await page.getByRole("button", { name: "Close changes drawer" }).focus();
    await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    const focusStyle = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focusStyle.outlineStyle).toBe("solid");
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);
  });

  test("mobile Changes drawer traps focus and Escape restores its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" MOBILE-DRAWER");
    await clickOutsideCommit(page);

    const trigger = page.locator("#xyle-changes");
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Changes" });
    await expect(drawer).toHaveAttribute("data-xyle-drawer-mode", "modal");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).toHaveAttribute("inert", "");
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
    const id = await findNodeByText(page, "This Xyle demo starts");
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

  test("Locate reports when a changed target is no longer available", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" stale target");
    await clickOutsideCommit(page);

    await page.evaluate((nodeId) => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      doc?.querySelector(`[data-xyle-node="${nodeId}"]`)?.remove();
    }, id);
    await page.click("#xyle-changes");
    await page
      .locator("#xyle-changes-drawer .xyle-change-row")
      .first()
      .getByRole("button", { name: "Locate" })
      .click();

    await expect(page.locator("#xyle-flash")).toContainText(
      "This change target is no longer available",
    );
    expect(await opsCount(page)).toBe(1);
    await expect(page.locator("#xyle-dirty")).toBeVisible();
  });

  test("Changes drawer can discard the whole draft and reload published content", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
    const original = await textOf(page, id!);
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" THROW-AWAY");
    await clickOutsideCommit(page);
    await page.setViewportSize({ width: 480, height: 700 });

    await page.click("#xyle-changes");
    await page.click("#xyle-discard");
    const confirmation = page.getByRole("alertdialog", {
      name: "Discard unpublished changes?",
    });
    await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await expect(confirmation).toContainText(
      "1 unpublished change will be removed before you reload the published page.",
    );
    const appearance = await confirmation.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        boxSizing: style.boxSizing,
        boxShadow: style.boxShadow,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    expect(appearance).toMatchObject({ boxSizing: "border-box", boxShadow: "none" });
    expect(appearance.left).toBeGreaterThanOrEqual(16);
    expect(appearance.right).toBeLessThanOrEqual(464);
    expect(appearance.height).toBeLessThan(240);
    expect(Math.abs((appearance.top + appearance.bottom) / 2 - 350)).toBeLessThan(2);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator("#xyle-discard")).toBeFocused();
    await expect(page.locator("#xyle-dirty")).toBeVisible();

    await page.click("#xyle-discard");
    await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator("#xyle-dirty")).toBeHidden();
    await expect(page.locator("#xyle-changes-drawer")).toHaveCount(0);
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
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
    const id = await findNodeByText(page, "See how Xyle works");
    const original = await textOf(page, id!);
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type("!!!");
    await page.keyboard.press("Escape");
    await expect.poll(async () => opsCount(page), { timeout: 3000 }).toBe(0);
    expect(await textOf(page, id!)).toBe(original);
  });

  test("keyboard undo stays native inside shell form fields", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" HISTORY");
    await clickOutsideCommit(page);
    await expect.poll(async () => opsCount(page)).toBe(1);

    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-seo-shortcut").click();
    const title = page.getByRole("dialog", { name: "SEO metadata" }).locator('[name="title"]');
    const originalTitle = await title.inputValue();
    await title.press("End");
    await title.pressSequentially("X");
    await title.press("Control+z");
    await expect(title).toHaveValue(originalTitle);
    await expect.poll(async () => opsCount(page)).toBe(1);
  });

  test("keyboard undo/redo works outside fields", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "This Xyle demo starts");
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

  test("inline spans show inline formatting without a misleading block selector", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/index.html");
    const id = await findNodeByText(page, "Your files · Your hosting · Your decision");
    expect(id).toBeTruthy();
    await editNode(page, id!);
    await setSelection(page, { nodeId: id!, selectAll: true });

    const tools = page.locator(".xyle-format-tools");
    await expect(tools.getByRole("button", { name: "Bold" })).toBeVisible();
    await expect(tools.locator('select[aria-label="Block style"]')).toHaveCount(0);
    await expect(tools.getByRole("separator")).toHaveCount(0);
  });

  test("publishes a human-created bulleted list", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const firstId = await findNodeByText(page, "The first Xyle edits");
    const secondId = await findNodeByText(page, "Each pending change stays visible");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    await editNode(page, firstId!);
    await setSelection(page, {
      nodeId: firstId!,
      endNodeId: secondId!,
      selectAll: true,
    });
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
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["setBlockFormat"]);

    await page.locator("#xyle-changes").click();
    const change = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(change).toHaveCount(1);
    await expect(change.locator(".xyle-change-before")).toContainText("<p");
    await expect(change.locator(".xyle-change-after")).toContainText("<ul>");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get("/about.html")).text();
    expect(source).toContain("<ul>");
    expect(source).not.toContain("data-xyle-node");

    await page.goto("/about.html");
    const list = page.locator("ul").filter({ hasText: "The first Xyle edits" });
    await expect(list.locator(":scope > li")).toHaveCount(2);
    await expect(list).toContainText("Each pending change stays visible");
  });

  test("returns a draft list to paragraphs from the block-style menu", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const firstId = await findNodeByText(page, "The first Xyle edits");
    const secondId = await findNodeByText(page, "Each pending change stays visible");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();

    await editNode(page, firstId!);
    await setSelection(page, { nodeId: firstId!, selectAll: true });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("unordered-list");

    await editNode(page, firstId!);
    await setSelection(page, { nodeId: firstId!, selectAll: true });
    const blockStyle = page.locator('.xyle-format-tools select[aria-label="Block style"]');
    await expect(blockStyle).toHaveValue("unordered-list");
    await expect(blockStyle.locator('option[value="heading-1"]')).toHaveCount(1);
    await blockStyle.selectOption("paragraph");

    const first = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${firstId}"]`);
    const second = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${secondId}"]`);
    await expect(first).toHaveJSProperty("tagName", "P");
    await expect(second).toHaveJSProperty("tagName", "P");
    await expect.poll(async () => opsCount(page)).toBe(0);
  });

  test("keeps one canonical change through repeated paragraph, heading, and list transitions", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/about.html");
    const id = await findNodeByText(page, "The first Xyle edits");
    expect(id).toBeTruthy();
    const transitions = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "h2",
      "ol",
      "h3",
      "p",
      "ul",
      "ol",
      "p",
    ] as const;
    const optionFor = {
      p: "paragraph",
      h1: "heading-1",
      h2: "heading-2",
      h3: "heading-3",
      h4: "heading-4",
      h5: "heading-5",
      h6: "heading-6",
      ul: "unordered-list",
      ol: "ordered-list",
    } as const;
    const target = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`);

    for (const transition of transitions) {
      await editNode(page, id!);
      await setSelection(page, { nodeId: id!, selectAll: true });
      await page
        .locator('.xyle-format-tools select[aria-label="Block style"]')
        .selectOption(optionFor[transition]);
      if (transition === "ul" || transition === "ol") {
        await expect(target).toHaveJSProperty("tagName", "LI");
        await expect(target.locator("..")).toHaveJSProperty("tagName", transition.toUpperCase());
      } else {
        await expect(target).toHaveJSProperty("tagName", transition.toUpperCase());
      }
      const operations = await currentOps(page);
      if (transition === "p") expect(operations).toHaveLength(0);
      else {
        expect(operations).toHaveLength(1);
        expect(operations[0]?.op.type).toBe("setBlockFormat");
      }
    }

    await page.keyboard.press("Control+z");
    await expect(target).toHaveJSProperty("tagName", "LI");
    await expect(target.locator("..")).toHaveJSProperty("tagName", "OL");
    await expect.poll(async () => opsCount(page)).toBe(1);
    await page.keyboard.press("Control+Shift+z");
    await expect(target).toHaveJSProperty("tagName", "P");
    await expect.poll(async () => opsCount(page)).toBe(0);

    await editNode(page, id!);
    await setSelection(page, { nodeId: id!, selectAll: true });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("heading-4");
    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/about.html");
    await expect(
      page.getByRole("heading", { level: 4, name: /The first Xyle edits/ }),
    ).toBeVisible();
  });

  test("merges adjacent list items created in separate actions before publication", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const firstId = await findNodeByText(page, "Plain block");
    const secondId = await findNodeByText(page, "Heading block");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();

    for (const id of [firstId!, secondId!]) {
      await editNode(page, id);
      await setSelection(page, { nodeId: id, selectAll: true });
      await page
        .locator('.xyle-format-tools select[aria-label="Block style"]')
        .selectOption("ordered-list");
    }

    const preview = page.frameLocator("#xyle-preview");
    const draftList = preview.locator("main > ol");
    await expect(draftList).toHaveCount(1);
    await expect(draftList.locator(":scope > li")).toHaveCount(2);
    await expect(
      draftList.evaluate((list) =>
        [...list.childNodes]
          .filter((node) => node.nodeType === Node.COMMENT_NODE)
          .map((node) => node.textContent?.trim()),
      ),
    ).resolves.toContain("scalar separator");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["setBlockFormat"]);

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/formatting-matrix.html");
    const publishedList = page.locator("main > ol");
    await expect(publishedList).toHaveCount(1);
    await expect(publishedList.locator(":scope > li")).toHaveCount(2);
    expect(await publishedList.evaluate((list) => list.innerHTML)).toContain(
      "<!-- scalar separator -->",
    );
  });

  test("publishes a block after an unsupported sibling without crossing the boundary", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const beforeOrphanId = await findNodeByText(page, "Before orphan text");
    const afterOrphanId = await findNodeByText(page, "After orphan text");
    expect(beforeOrphanId).toBeTruthy();
    expect(afterOrphanId).toBeTruthy();
    await editNode(page, beforeOrphanId!);
    await setSelection(page, {
      nodeId: beforeOrphanId!,
      endNodeId: afterOrphanId!,
      selectAll: true,
    });
    await expect(page.locator('.xyle-format-tools select[aria-label="Block style"]')).toHaveCount(
      0,
    );

    const id = await findNodeByText(page, "After divider");
    expect(id).toBeTruthy();
    await editNode(page, id!);
    await setSelection(page, { nodeId: id!, selectAll: true });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("heading-3");
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`),
    ).toHaveJSProperty("tagName", "H3");

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/formatting-matrix.html");
    await expect(page.getByRole("img", { name: "Divider" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "After divider" })).toBeVisible();
  });

  test("restores authored list attributes after all items become scalar blocks", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const firstId = await findNodeByText(page, "Alpha item");
    const middleId = await findNodeByText(page, "Beta item");
    const lastId = await findNodeByText(page, "Gamma item");
    expect(firstId).toBeTruthy();
    expect(middleId).toBeTruthy();
    expect(lastId).toBeTruthy();

    await editNode(page, firstId!);
    await setSelection(page, {
      nodeId: firstId!,
      endNodeId: lastId!,
      selectAll: true,
    });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("paragraph");
    const preview = page.frameLocator("#xyle-preview");
    await expect(preview.locator("ul.authored-list")).toHaveCount(0);

    for (const id of [firstId!, lastId!]) {
      await editNode(page, id);
      await setSelection(page, { nodeId: id, selectAll: true });
      await page
        .locator('.xyle-format-tools select[aria-label="Block style"]')
        .selectOption("unordered-list");
    }
    const restoredLists = preview.locator("ul.authored-list");
    await expect(restoredLists).toHaveCount(2);
    await expect(restoredLists.first()).toHaveAttribute("id", "formatting-examples");
    await expect(restoredLists.last()).not.toHaveAttribute("id", "formatting-examples");
    await expect(restoredLists.first()).toHaveAttribute("aria-label", "Formatting examples");
    await expect(restoredLists.first()).toContainText("Alpha item");
    await expect(restoredLists.last()).toContainText("Gamma item");
    expect(await restoredLists.first().evaluate((list) => list.innerHTML)).toContain(
      "<!-- authored list start -->",
    );
    expect(await restoredLists.last().evaluate((list) => list.innerHTML)).toContain(
      "<!-- authored list end -->",
    );

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/formatting-matrix.html");
    const publishedLists = page.locator("ul.authored-list");
    await expect(publishedLists).toHaveCount(2);
    await expect(publishedLists.first()).toHaveAttribute("id", "formatting-examples");
    expect(await publishedLists.first().evaluate((list) => list.innerHTML)).toContain(
      "<!-- authored list start -->",
    );
    expect(await publishedLists.last().evaluate((list) => list.innerHTML)).toContain(
      "<!-- authored list end -->",
    );
  });

  test("reconciles repeated authored-list transitions and preserves wrapper attributes", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/formatting-matrix.html");
    const id = await findNodeByText(page, "Beta item");
    expect(id).toBeTruthy();
    const preview = page.frameLocator("#xyle-preview");
    const target = preview.locator(`[data-xyle-node="${id}"]`);
    const selectFormat = async (format: string): Promise<void> => {
      await editNode(page, id!);
      await setSelection(page, { nodeId: id!, selectAll: true });
      await page
        .locator('.xyle-format-tools select[aria-label="Block style"]')
        .selectOption(format);
    };

    await selectFormat("heading-2");
    await expect(target).toHaveJSProperty("tagName", "H2");
    await expect(preview.locator("ul.authored-list")).toHaveCount(2);
    await expect
      .poll(() =>
        preview.locator("body").evaluate((body) => {
          const comments: string[] = [];
          const walker = body.ownerDocument.createTreeWalker(
            body,
            body.ownerDocument.defaultView!.NodeFilter.SHOW_COMMENT,
          );
          while (walker.nextNode()) comments.push(walker.currentNode.textContent?.trim() ?? "");
          return comments;
        }),
      )
      .toEqual(expect.arrayContaining(["authored list start", "authored list end"]));
    await selectFormat("ordered-list");
    await expect(target).toHaveJSProperty("tagName", "LI");
    await expect(target.locator("..")).toHaveJSProperty("tagName", "OL");
    await selectFormat("paragraph");
    await expect(target).toHaveJSProperty("tagName", "P");
    await selectFormat("heading-6");
    await expect(target).toHaveJSProperty("tagName", "H6");
    await selectFormat("unordered-list");
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(preview.locator("ul.authored-list")).toHaveCount(1);
    await expect(
      preview.locator('ul.authored-list[aria-label="Formatting examples"] > li'),
    ).toHaveCount(3);

    await page.keyboard.press("Control+z");
    await expect(target).toHaveJSProperty("tagName", "H6");
    await expect.poll(async () => opsCount(page)).toBe(1);
    await page.keyboard.press("Control+Shift+z");
    await expect(target).toHaveJSProperty("tagName", "LI");
    await expect.poll(async () => opsCount(page)).toBe(0);

    await selectFormat("ordered-list");
    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/formatting-matrix.html");
    await expect(page.locator('ul.authored-list[aria-label="Formatting examples"]')).toHaveCount(2);
    const selectedList = page.locator('ol.authored-list[aria-label="Formatting examples"]');
    await expect(selectedList).toHaveCount(1);
    await expect(selectedList.locator(":scope > li")).toHaveText("Beta item");
  });

  test("publishes a human-created numbered list", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const firstId = await findNodeByText(page, "The first Xyle edits");
    const secondId = await findNodeByText(page, "Each pending change stays visible");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    await editNode(page, firstId!);
    await setSelection(page, {
      nodeId: firstId!,
      endNodeId: secondId!,
      selectAll: true,
    });
    await page
      .locator('.xyle-format-tools select[aria-label="Block style"]')
      .selectOption("ordered-list");
    const first = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${firstId}"]`);
    const second = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${secondId}"]`);
    await expect(first).toHaveJSProperty("tagName", "LI");
    await expect(second).toHaveJSProperty("tagName", "LI");
    await expect(first.locator("..")).toHaveJSProperty("tagName", "OL");
    expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["setBlockFormat"]);

    await page.locator("#xyle-changes").click();
    const change = page.getByRole("dialog", { name: "Changes" }).locator(".xyle-change-row");
    await expect(change.locator(".xyle-change-before")).toContainText("<p");
    await expect(change.locator(".xyle-change-after")).toContainText("<ol>");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    await page.goto("/about.html");
    const list = page.locator("ol").filter({ hasText: "The first Xyle edits" });
    await expect(list.locator(":scope > li")).toHaveCount(2);
    await expect(list).toContainText("Each pending change stays visible");
  });

  test("updates SEO metadata from the human editor", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const originalTitle = await page.evaluate(
      () =>
        (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.title ?? "",
    );
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-seo-shortcut").click();
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

    await page.locator("#xyle-changes").click();
    const change = page
      .getByRole("dialog", { name: "Changes" })
      .locator(".xyle-change-row")
      .filter({ hasText: "Updated page title" });
    await expect(change.locator(".xyle-change-before")).toContainText(originalTitle);
    await expect(change.locator(".xyle-change-after")).toContainText("Updated page title");
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.locator("#xyle-publish").click();
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const source = await (await page.request.get("/index.html")).text();
    expect(source).toContain("<title>Updated page title</title>");
    expect(source).not.toContain("data-xyle-node");

    await page.goto("/index.html");
    await expect(page).toHaveTitle("Updated page title");
  });

  test("desktop drawers overlay the preview without changing its viewport", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const seoShortcut = page.locator("#xyle-seo-shortcut");
    const structureShortcut = page.locator("#xyle-structure-shortcut");

    await page.locator("#xyle-control-hitbox").hover();
    await seoShortcut.click();
    const seo = page.getByRole("dialog", { name: "SEO metadata" });
    const title = seo.locator('[name="title"]');
    await expect(seo).toHaveAttribute("data-xyle-drawer-mode", "overlay");
    await expect(seo).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#xyle-control-dock")).not.toHaveAttribute("inert", "");
    const seoShellBox = await page.locator("#xyle-shell").boundingBox();
    const seoBox = await seo.boundingBox();
    expect(seoShellBox).not.toBeNull();
    expect(seoBox).not.toBeNull();
    expect(seoShellBox!.width).toBeCloseTo(await page.evaluate(() => window.innerWidth), 0);
    expect(seoBox!.x + seoBox!.width).toBeCloseTo(await page.evaluate(() => window.innerWidth), 0);
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(seo).toHaveCount(0);
    await expect(seoShortcut).toBeFocused();

    await structureShortcut.click();
    const structure = page.getByRole("dialog", { name: "Outline" });
    await expect(structure).toHaveAttribute("data-xyle-drawer-mode", "overlay");
    await expect(structure).not.toHaveAttribute("aria-modal", "true");
    const shellBox = await page.locator("#xyle-shell").boundingBox();
    const structureBox = await structure.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(structureBox).not.toBeNull();
    expect(shellBox!.width).toBeCloseTo(await page.evaluate(() => window.innerWidth), 0);
    expect(structureBox!.x + structureBox!.width).toBeCloseTo(
      await page.evaluate(() => window.innerWidth),
      0,
    );

    await page.setViewportSize({ width: 650, height: 800 });
    await expect(structure).toHaveAttribute("data-xyle-drawer-mode", "modal");
    await expect(structure).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).toHaveAttribute("inert", "");
    await expect(page.locator("html")).not.toHaveAttribute("data-xyle-companion-open", "");
    await expect(structure.getByRole("button", { name: "Close outline" })).toBeFocused();
    await page.setViewportSize({ width: 1_000, height: 800 });
    await expect(structure).toHaveAttribute("data-xyle-drawer-mode", "overlay");
    await expect(structure).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await expect(page.locator("html")).not.toHaveAttribute("data-xyle-companion-open", "");

    const rows = structure.locator(".xyle-outline-node");
    const initialOrder = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-section-id")),
    );
    await rows.first().locator(".xyle-outline-select").click();
    const firstUp = rows.first().getByRole("button", { name: "Move up", exact: true });
    await expect(firstUp).toBeDisabled();
    await expect(firstUp).toHaveAttribute("title", "Already first");
    await rows.first().getByRole("button", { name: "Move down", exact: true }).click();
    const movedOrder = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-section-id")),
    );
    expect(movedOrder).toEqual([initialOrder[1], initialOrder[0], ...initialOrder.slice(2)]);
    const movedRow = structure.locator(`.xyle-outline-node[data-section-id="${initialOrder[0]}"]`);
    await movedRow.locator(".xyle-outline-select").click();
    await movedRow.getByRole("button", { name: "Move up", exact: true }).click();
    await expect
      .poll(() =>
        rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-section-id"))),
      )
      .toEqual(initialOrder);

    const beforeDuplicate = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-section-id")),
    );
    await rows.first().locator(".xyle-outline-menu-trigger").click();
    await rows.first().getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    const afterDuplicate = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-section-id")),
    );
    expect(afterDuplicate[0]).toBe(beforeDuplicate[0]);
    expect(afterDuplicate[1]).not.toBe(beforeDuplicate[1]);
    expect(afterDuplicate.slice(2)).toEqual(beforeDuplicate.slice(1));
    await page.keyboard.press("Control+z");
    await expect
      .poll(() =>
        rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-section-id"))),
      )
      .toEqual(beforeDuplicate);

    await page.evaluate(() => {
      const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
      frame.contentWindow?.scrollTo(0, 500);
    });
    await rows.first().locator(".xyle-outline-select").click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const frame = document.querySelector("#xyle-preview") as HTMLIFrameElement;
          const section = frame.contentDocument?.querySelector<HTMLElement>(
            "main > section[data-xyle-node]",
          );
          if (!section || !frame.contentWindow) return false;
          const rect = section.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < frame.contentWindow.innerHeight;
        }),
      )
      .toBe(true);
    await expect(structure).toBeVisible();
    await expect(structureShortcut).toHaveAttribute("aria-expanded", "true");

    const id = await findNodeByText(page, "Edit your static site visually");
    expect(id).toBeTruthy();
    await editNode(page, id!);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`),
    ).toHaveAttribute("contenteditable", "true");
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
    const id = await findNodeByText(page, "This Xyle demo starts");
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

test("publishes ordinary section movement through public reload", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  const sectionIds = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll("main > section[data-xyle-node]")].map(
      (section) => section.getAttribute("data-xyle-node")!,
    );
  });
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const firstRow = page.locator(`.xyle-outline-node[data-section-id="${sectionIds[0]}"]`);
  await firstRow.locator(".xyle-outline-select").click();
  await firstRow.getByRole("button", { name: "Move down", exact: true }).click();
  expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["moveSection"]);

  await page.locator("#xyle-changes").click();
  const change = page
    .getByRole("dialog", { name: "Changes" })
    .locator(".xyle-change-row")
    .filter({ hasText: "Moved" });
  await expect(change.locator(".xyle-change-before")).toContainText("original position");
  await expect(change.locator(".xyle-change-after")).toContainText("later");
  await page.locator("#xyle-changes-close").click();

  await page.locator("#xyle-publish").click();
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  const source = await (await page.request.get("/index.html")).text();
  expect(source.indexOf('class="proof-strip"')).toBeLessThan(source.indexOf('class="hero"'));
  expect(source).not.toContain("data-xyle-node");

  await page.goto("/index.html");
  await expect
    .poll(() =>
      page.locator("main > section").evaluateAll((sections) => sections.map((s) => s.className)),
    )
    .toEqual(["proof-strip", "hero", "services", "work-standard", "callout"]);
});

test("publishes section visibility through public reload", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const heroRow = page
    .locator(".xyle-outline-node")
    .filter({ hasText: "Edit your static site visually" });
  await heroRow.locator(".xyle-outline-menu-trigger").click();
  await heroRow.getByRole("menuitem", { name: "Hide", exact: true }).click();
  expect((await currentOps(page)).map((entry) => entry.op.type)).toEqual(["sectionVisibility"]);

  await page.locator("#xyle-changes").click();
  const change = page
    .getByRole("dialog", { name: "Changes" })
    .locator(".xyle-change-row")
    .filter({ hasText: "hidden" });
  await expect(change.locator(".xyle-change-before")).toContainText("visible");
  await expect(change.locator(".xyle-change-after")).toContainText("hidden");
  await page.locator("#xyle-changes-close").click();

  await page.locator("#xyle-publish").click();
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  const source = await (await page.request.get("/index.html")).text();
  expect(source).toMatch(/<section[^>]*class="hero"[^>]*hidden/);
  expect(source).not.toContain("data-xyle-node");

  await page.goto("/index.html");
  await expect(page.locator("main > section.hero")).toBeHidden();
});

test("reorders safe sibling areas by dragging in Outline", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  const originalOrder = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll("main > section[data-xyle-node]")].map((section) =>
      section.getAttribute("data-xyle-node"),
    );
  });
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const outline = page.getByRole("dialog", { name: "Outline" });
  const rows = outline.locator(".xyle-outline-node");
  const secondRowBox = await rows.nth(1).locator(".xyle-outline-row").boundingBox();
  expect(secondRowBox).not.toBeNull();
  await rows
    .first()
    .locator(".xyle-outline-drag")
    .dragTo(rows.nth(1).locator(".xyle-outline-row"), {
      targetPosition: { x: 20, y: secondRowBox!.height - 2 },
    });
  await expect
    .poll(() =>
      rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-section-id"))),
    )
    .toEqual([originalOrder[1], originalOrder[0], ...originalOrder.slice(2)]);
  await expect(page.locator("#xyle-count")).toHaveText("1");
});

test("deletes, restores, and publishes a safe area from Outline", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const outline = page.getByRole("dialog", { name: "Outline" });
  const heroRow = outline
    .locator(".xyle-outline-node")
    .filter({ hasText: "Edit your static site visually" });

  await heroRow.locator(".xyle-outline-menu-trigger").click();
  await heroRow.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.frameLocator("#xyle-preview").locator("main > section.hero")).toHaveCount(0);
  await expect(heroRow).toHaveAttribute("data-deleted", "");
  await expect(heroRow).toContainText("Deleted");
  await expect(heroRow.locator("button.xyle-outline-disclosure")).toHaveCount(0);
  await heroRow.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.frameLocator("#xyle-preview").locator("main > section.hero")).toHaveCount(1);
  await expect.poll(async () => opsCount(page)).toBe(0);

  await heroRow.locator(".xyle-outline-menu-trigger").click();
  await heroRow.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.locator("#xyle-changes").click();
  const deletion = page.locator('.xyle-change-row[aria-label*="Delete area"]');
  await expect(deletion).toContainText("Edit your static site visually");
  await expect(deletion).toContainText("Deleted");
  await page.locator("#xyle-changes-close").click();

  await page.locator("#xyle-publish").click();
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  const source = await (await page.request.get("/index.html")).text();
  expect(source).not.toContain('class="hero"');
  expect(source).toContain('class="proof-strip"');
  await page.goto("/index.html");
  await expect(page.locator("main > section.hero")).toHaveCount(0);
});

test("temporarily suppresses descendant edits while an area is deleted", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");
  const headingId = await findNodeByText(page, "Edit your static site visually");
  expect(headingId).toBeTruthy();
  await editNode(page, headingId!);
  await setSelection(page, { nodeId: headingId!, selectAll: true });
  await page.keyboard.insertText("Edited before deletion");
  await clickOutsideCommit(page);

  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const outline = page.getByRole("dialog", { name: "Outline" });
  const heroRow = outline
    .locator(".xyle-outline-node")
    .filter({ hasText: "Edited before deletion" });
  await heroRow.locator(".xyle-outline-menu-trigger").click();
  await heroRow.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.locator("#xyle-changes").click();
  const changes = page.getByRole("dialog", { name: "Changes" });
  await expect(changes.locator('.xyle-change-row[aria-label*="Delete area"]')).toHaveCount(1);
  await expect(changes.locator(".xyle-change-type").filter({ hasText: "Text" })).toHaveCount(0);
  await page.locator("#xyle-changes-close").click();

  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const deletedRow = page.locator(".xyle-outline-node[data-deleted]");
  await deletedRow.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.frameLocator("#xyle-preview").getByRole("heading", { name: "Edited before deletion" }),
  ).toBeVisible();
  await page.locator("#xyle-changes").click();
  await expect(page.locator(".xyle-change-type").filter({ hasText: "Text" })).toHaveCount(1);
  await expect(page.locator('.xyle-change-row[aria-label*="Delete area"]')).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Changes" })).not.toContainText(
    "data-xyle-outline-selected",
  );
});

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
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const firstRow = page.locator(`.xyle-outline-node[data-section-id="${sectionIds[0]}"]`);
  await firstRow.locator(".xyle-outline-select").click();
  await firstRow.getByRole("button", { name: "Move down", exact: true }).click();
  const secondRow = page.locator(`.xyle-outline-node[data-section-id="${sectionIds[1]}"]`);
  await secondRow.locator(".xyle-outline-select").click();
  await expect(secondRow.getByRole("button", { name: "Move down", exact: true })).toBeDisabled();
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

  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const structurePanel = page.getByRole("dialog", { name: "Outline" });
  const restoredFirstRow = structurePanel.locator(
    `.xyle-outline-node[data-section-id="${sectionIds[0]}"]`,
  );
  await restoredFirstRow.locator(".xyle-outline-menu-trigger").click();
  await restoredFirstRow.getByRole("menuitem", { name: "Hide", exact: true }).click();
  await expect(first).toHaveJSProperty("hidden", true);
  const hiddenFirstRow = structurePanel.locator(
    `.xyle-outline-node[data-section-id="${sectionIds[0]}"]`,
  );
  await hiddenFirstRow.locator(".xyle-outline-menu-trigger").click();
  await hiddenFirstRow.getByRole("menuitem", { name: "Show", exact: true }).click();
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
