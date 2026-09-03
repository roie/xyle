import { expect, test } from "@playwright/test";
import { clickNode, currentOps, findNodeByText, loginAndOpenEditor, opsCount } from "./helpers.ts";
import type { MediaState } from "../src/types.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const SVG_BYTES = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>`,
);

test.describe("media editing", () => {
  test("hovering an image exposes compact Replace/Media controls", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const id = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      for (const el of doc.querySelectorAll("img[data-xyle-node]")) {
        if ((el as HTMLImageElement).getAttribute("src") === "/assets/hero-fallback.jpg") {
          return el.getAttribute("data-xyle-node");
        }
      }
      return null;
    });
    expect(id).toBeTruthy();

    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`);
    await image.hover();
    const tools = page.locator(".xyle-img-tools");
    await expect(tools).toBeVisible();
    await expect(tools.getByRole("button", { name: "Replace" })).toBeEnabled();
    await expect(tools.getByRole("button", { name: "Media" })).toBeEnabled();
    await expect(tools.getByRole("button", { name: "Crop" })).toBeEnabled();
    await expect(tools.getByRole("button", { name: "Alt" })).toBeEnabled();
    const geometry = await tools.boundingBox();
    const viewport = page.viewportSize()!;
    expect(geometry).toBeTruthy();
    expect(geometry!.x).toBeGreaterThanOrEqual(0);
    expect(geometry!.y).toBeGreaterThanOrEqual(0);
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(viewport.height);

    // The demo's prominent image is intentionally simple so every media action is available.
    const responsiveImages = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc.querySelectorAll("picture, img[srcset]").length;
    });
    expect(responsiveImages).toBe(0);

    await tools.getByRole("button", { name: "Media" }).click();
    const mediaDrawer = page.getByRole("dialog", { name: "Media" });
    const currentImage = mediaDrawer.getByRole("button", {
      name: "Choose /assets/hero-fallback.jpg (currently used)",
    });
    await expect(currentImage).toHaveAttribute("aria-current", "true");
    await expect(currentImage.locator(".xyle-media-current")).toHaveText("Current");
    await mediaDrawer.getByRole("button", { name: "Choose /misc/team.jpg" }).click();
    await expect(image).toHaveAttribute("src", "/misc/team.jpg");
    await expect.poll(async () => opsCount(page)).toBe(1);
  });

  test("keyboard image activation focuses actions and Escape returns focus", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.focus();
    await page.keyboard.press("Enter");
    const replace = page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" });
    await expect(replace).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(image).toBeFocused();
    await expect(page.locator(".xyle-img-tools")).toHaveCount(0);
  });

  test("uploads to the media library before applying an image", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-media-shortcut").click();
    const drawer = page.locator("#xyle-media-drawer");
    await expect(drawer).toBeVisible();

    const chooserPromise = page.waitForEvent("filechooser");
    await drawer.getByRole("button", { name: "Upload to library" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "library-upload.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect(drawer.locator(".xyle-media-tab[data-tab=uploads]")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const uploaded = drawer.locator('button[aria-label^="Choose /__media/"]');
    await expect(uploaded).toHaveCount(1);
    expect(await opsCount(page)).toBe(0);

    await drawer.getByRole("button", { name: "Close media drawer" }).click();
    const image = page.frameLocator("#xyle-preview").locator('img[src="/assets/hero-wide.webp"]');
    const imageId = await image.getAttribute("data-xyle-node");
    expect(imageId).toBeTruthy();
    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Media" }).click();
    await page.locator('#xyle-media-drawer button[aria-label^="Choose /__media/"]').click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect
      .poll(async () =>
        page
          .frameLocator("#xyle-preview")
          .locator(`[data-xyle-node="${imageId}"]`)
          .getAttribute("src"),
      )
      .toMatch(/^blob:/);
  });

  test("invalid media upload reports a visible error and keeps the drawer usable", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-media-shortcut").click();
    const drawer = page.locator("#xyle-media-drawer");

    const chooserPromise = page.waitForEvent("filechooser");
    await drawer.getByRole("button", { name: "Upload to library" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"),
    });

    await expect(page.locator("#xyle-flash")).toContainText(
      "Only JPEG, PNG, WebP and AVIF uploads are supported",
    );
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Upload to library" })).toBeEnabled();
    await expect(drawer.locator('button[aria-label^="Choose /__media/"]')).toHaveCount(0);
    expect(await opsCount(page)).toBe(0);
  });

  test("replacing an image previews via blob and records a media change", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const id = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      for (const el of doc.querySelectorAll("img[data-xyle-node]")) {
        if ((el as HTMLImageElement).getAttribute("src") === "/assets/hero-wide.webp") {
          return el.getAttribute("data-xyle-node");
        }
      }
      return null;
    });
    expect(id).toBeTruthy();

    // select the image, then click Replace
    await page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`).click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.querySelectorAll(".xyle-img-tools button").length),
      )
      .toBe(5);

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".xyle-img-tools button:has-text('Replace')").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });

    // immediate blob preview + recorded content-addressed src op
    await expect
      .poll(async () =>
        page.evaluate((nodeId) => {
          const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
            .contentDocument!;
          const img = doc.querySelector(`[data-xyle-node="${nodeId}"]`) as HTMLImageElement;
          return img.src.startsWith("blob:") && img.naturalWidth > 0;
        }, id),
      )
      .toBe(true);

    const ops = await currentOps(page);
    const mediaOp = ops.find((entry) => entry.op.type === "media");
    expect((mediaOp?.op as { value: MediaState } | undefined)?.value.source).toMatchObject({
      kind: "staged",
      assetId: expect.stringMatching(/^\/__media\/[0-9a-f]{64}\.png$/),
    });
  });

  test("adjusts image crop and focal point as one change", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Crop" }).click();
    const dialog = page.getByRole("dialog", { name: "Crop & focal point" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).toHaveAttribute("inert", "");
    await expect(page.locator("#xyle-control-dock")).toHaveAttribute("inert", "");
    await expect(page.locator("dialog.xyle-dialog")).toHaveCount(0);
    const stageBox = await dialog.locator(".xyle-crop-stage").boundingBox();
    const panelBox = await dialog.locator(".xyle-media-editor-panel").boundingBox();
    expect(stageBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(panelBox!.x + 1);
    expect(stageBox!.width).toBeGreaterThan(600);
    const focalTarget = dialog.locator(".xyle-focal-target");
    const done = dialog.getByRole("button", { name: "Done" });
    await expect(focalTarget).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(done).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(focalTarget).toBeFocused();
    const bottomRight = dialog.getByRole("button", { name: "Bottom right" });
    await bottomRight.click();
    await expect(bottomRight).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("#xyle-focal-x")).toHaveValue("100");
    await expect(dialog.locator("#xyle-focal-y")).toHaveValue("100");
    await dialog.locator("select[name=fit]").selectOption("cover");
    await dialog.locator("#xyle-focal-x").fill("24");
    await dialog.locator("#xyle-focal-y").fill("68");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#xyle-control-dock")).not.toHaveAttribute("inert", "");
    await expect(image).toBeFocused();
    await expect.poll(async () => opsCount(page)).toBe(1);
    const op = (await currentOps(page)).find((entry) => entry.op.type === "media");
    expect((op?.op as { value: MediaState } | undefined)?.value).toMatchObject({
      framing: { fit: "cover" },
      focus: { x: 0.24, y: 0.68 },
    });
    expect((op?.op as { value: MediaState } | undefined)?.value.crop).not.toBeNull();
    await expect(image).toHaveJSProperty("style.objectFit", "cover");
    await expect(image).toHaveJSProperty("style.objectPosition", "24% 68%");
  });

  test("keeps image framing usable when the viewport becomes narrow", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Crop" }).click();

    const dialog = page.getByRole("dialog", { name: "Crop & focal point" });
    await expect(dialog.locator(".xyle-crop-stage")).toHaveCSS("width", "720px");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.locator(".xyle-crop-stage")).toHaveCSS("width", "358px");
    const dialogBox = await dialog.boundingBox();
    const stageBox = await dialog.locator(".xyle-crop-stage").boundingBox();
    const panelBox = await dialog.locator(".xyle-media-editor-panel").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844);
    expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(panelBox!.y + 1);
    await expect(dialog.getByRole("button", { name: "Done" })).toBeInViewport();
  });

  test("cancelling crop restores the image without a pending change", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    const originalStyle = await image.evaluate((element) => (element as HTMLElement).style.cssText);

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Crop" }).click();
    const dialog = page.getByRole("dialog", { name: "Crop & focal point" });
    await dialog.locator("select[name=fit]").selectOption("contain");
    await dialog.locator("#xyle-zoom").fill("2");
    await dialog.locator("#xyle-focal-x").fill("17");
    await dialog.locator("#xyle-focal-y").fill("83");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(image).toBeFocused();
    expect(await image.evaluate((element) => (element as HTMLElement).style.cssText)).toBe(
      originalStyle,
    );
    expect(await opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("upload path uses detected bytes instead of the supplied MIME type", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "mislabelled.jpg",
      mimeType: "image/jpeg",
      buffer: PNG_BYTES,
    });

    await expect.poll(async () => opsCount(page)).toBe(1);
    const mediaOp = (await currentOps(page)).find((entry) => entry.op.type === "media");
    expect((mediaOp?.op as { value: MediaState } | undefined)?.value.source).toMatchObject({
      kind: "staged",
      assetId: expect.stringMatching(/^\/__media\/[0-9a-f]{64}\.png$/),
    });
  });

  test("pointer-opened media drawer restores focus to the selected image", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Media" }).click();
    const drawer = page.getByRole("dialog", { name: "Media" });
    await expect(drawer).toBeVisible();
    await page.evaluate(() => {
      document.querySelector(".xyle-img-tools")?.remove();
    });
    await drawer.getByRole("button", { name: "Close media drawer" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(image).toBeFocused();
  });

  test("repeated local replacements remain reachable through undo and redo", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const imageId = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector('img[data-xyle-node][src="/assets/hero-wide.webp"]')
        ?.getAttribute("data-xyle-node");
    });
    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${imageId}"]`);
    await image.click();
    const replaceWith = async (name: string, buffer: Buffer): Promise<void> => {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles({ name, mimeType: "image/png", buffer });
      await expect
        .poll(async () => (await image.getAttribute("src"))?.startsWith("blob:"))
        .toBe(true);
    };

    await replaceWith("first.png", PNG_BYTES);
    const firstPreview = await image.getAttribute("src");
    await replaceWith("second.png", Buffer.concat([PNG_BYTES, Buffer.from([0])]));
    const secondPreview = await image.getAttribute("src");
    expect(secondPreview).not.toBe(firstPreview);

    await page.keyboard.press("Control+z");
    await expect(image).toHaveAttribute("src", firstPreview!);
    await page.keyboard.press("Control+Shift+z");
    await expect(image).toHaveAttribute("src", secondPreview!);
  });

  test("Discard clears stale image selection after Media closes", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const imageId = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector('img[data-xyle-node][src="/assets/hero-wide.webp"]')
        ?.getAttribute("data-xyle-node");
    });
    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${imageId}"]`);
    await expect(image).toHaveAttribute("src", "/assets/hero-wide.webp");
    await image.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "discarded.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect.poll(async () => opsCount(page)).toBe(1);

    await page.locator(".xyle-img-tools").getByRole("button", { name: "Media" }).click();
    await expect(page.getByRole("dialog", { name: "Media" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Media" })).toHaveCount(0);
    await page.click("#xyle-changes");
    await expect(page.getByRole("dialog", { name: "Changes" })).toBeVisible();
    await page.click("#xyle-discard");
    await page.click("#xyle-discard-confirmation [data-discard]");

    await expect(page.locator("#xyle-media-drawer,#xyle-changes-drawer")).toHaveCount(0);
    await expect.poll(async () => opsCount(page)).toBe(0);
    await page.waitForFunction(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument;
      const restored = doc?.querySelector('img[data-xyle-node][src="/assets/hero-wide.webp"]');
      return Boolean(restored && document.getElementById("xyle-overlay-root"));
    });
  });

  test("desktop media drawer overlays the preview without changing its viewport", async ({
    page,
  }) => {
    let mediaRequests = 0;
    let releaseEmptyResponse!: () => void;
    const emptyResponseGate = new Promise<void>((resolve) => {
      releaseEmptyResponse = resolve;
    });
    await page.route("**/__xyle/api/media", async (route) => {
      mediaRequests += 1;
      if (mediaRequests === 1) {
        await route.continue();
        return;
      }
      await emptyResponseGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await loginAndOpenEditor(page, "/index.html");
    const mediaShortcut = page.locator("#xyle-media-shortcut");
    await page.locator("#xyle-control-hitbox").hover();
    await mediaShortcut.click();

    const drawer = page.getByRole("dialog", { name: "Media" });
    await expect(drawer).toHaveAttribute("data-xyle-drawer-mode", "overlay");
    await expect(drawer).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#xyle-control-dock")).not.toHaveAttribute("inert", "");
    const shellBox = await page.locator("#xyle-shell").boundingBox();
    const drawerBox = await drawer.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(drawerBox).not.toBeNull();
    expect(shellBox!.width).toBeCloseTo(await page.evaluate(() => window.innerWidth), 0);
    expect(drawerBox!.x + drawerBox!.width).toBeCloseTo(
      await page.evaluate(() => window.innerWidth),
      0,
    );
    await expect(drawer).toHaveAttribute("aria-busy", "true");
    await expect(drawer.getByRole("status")).toHaveText("Loading media…");

    releaseEmptyResponse();
    await expect(drawer).not.toHaveAttribute("aria-busy", "true");
    await expect(drawer.getByRole("status")).toHaveText(
      "No images found. Upload one to get started.",
    );

    const close = drawer.getByRole("button", { name: "Close media drawer" });
    await close.focus();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#xyle-control-dock")).not.toHaveAttribute("inert", "");
    await expect(mediaShortcut).toBeFocused();
  });

  test("media drawer keeps failures visible", async ({ page }) => {
    let mediaRequests = 0;
    await page.route("**/__xyle/api/media", async (route) => {
      mediaRequests += 1;
      if (mediaRequests === 1) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });

    await loginAndOpenEditor(page, "/index.html");
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-media-shortcut").click();

    const drawer = page.getByRole("dialog", { name: "Media" });
    await expect(drawer.getByRole("status")).toHaveText("Could not load media. Try again.");
    await expect(page.locator("#xyle-flash")).toHaveText("Could not load media.");
    await expect(page.locator("#xyle-flash")).toHaveClass(/visible/);
  });

  test("media drawer lists site images anywhere in the tree", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const teamId = await findNodeByText(page, "The Xyle demo team");
    void teamId;

    // open drawer through the image tools of the team photo
    const imgId = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      for (const el of doc.querySelectorAll("img[data-xyle-node]")) {
        if ((el as HTMLImageElement).getAttribute("src") === "/misc/team.jpg") {
          return el.getAttribute("data-xyle-node");
        }
      }
      return null;
    });
    expect(imgId).toBeTruthy();

    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${imgId}"]`);
    await image.click();
    const mediaButton = page.locator(".xyle-img-tools").getByRole("button", { name: "Media" });
    await expect(mediaButton).toBeVisible();
    await mediaButton.click();
    await expect(page.locator("#xyle-media-drawer")).toBeVisible();
    await expect(page.locator("dialog input[name=alt]")).toHaveCount(0);

    await page.evaluate(async () => {
      const res = await fetch("/__xyle/api/media");
      (window as unknown as { __mediaItems?: unknown }).__mediaItems = await res.json();
    });
    const items = await page.evaluate(
      () => (window as unknown as { __mediaItems?: Array<{ path: string }> }).__mediaItems ?? [],
    );
    const paths = items.map((i) => i.path);
    expect(paths).toContain("/misc/team.jpg");
    expect(paths).toContain("/misc/unused-badge.png"); // unused asset still discovered
    expect(paths).toContain("/assets/hero-wide.webp"); // non-uniform folders included

    const usedFlag = await page.evaluate(() => {
      const items2 = (
        window as unknown as { __mediaItems?: Array<{ path: string; usedBySimpleImg: boolean }> }
      ).__mediaItems!;
      return items2.find((i) => i.path === "/assets/hero-wide.webp")!.usedBySimpleImg;
    });
    expect(usedFlag).toBe(true);
  });

  test("unsupported image actions explain why they are unavailable", async ({ page }) => {
    await loginAndOpenEditor(page, "/qa-golden.html");
    const preview = page.frameLocator("#xyle-preview");

    await preview.locator('img[alt="Xyle test mark"]').click();
    let tools = page.locator(".xyle-img-tools");
    await expect(tools.getByRole("button", { name: "Crop" })).toBeDisabled();
    await expect(tools.getByRole("button", { name: "Crop" })).toHaveAttribute(
      "title",
      "This image format is not safely raster-cropped.",
    );
    await expect(tools.getByRole("button", { name: "Focus" })).toBeDisabled();
    await expect(tools.getByRole("button", { name: "Focus" })).toHaveAttribute(
      "title",
      "This image format is not safely raster-cropped.",
    );

    await preview.locator('img[alt="Responsive service preview"]').click();
    tools = page.locator(".xyle-img-tools");
    await expect(tools.getByRole("button", { name: "Replace" })).toBeDisabled();
    await expect(tools.getByRole("button", { name: "Replace" })).toHaveAttribute(
      "title",
      "Responsive image replacement is not supported yet",
    );
    await expect(tools.getByRole("button", { name: "Crop" })).toBeDisabled();
    await expect(tools.getByRole("button", { name: "Crop" })).toHaveAttribute(
      "title",
      "Responsive image sources need deliberate mapping.",
    );
    expect(await opsCount(page)).toBe(0);
  });

  test("upload API rejects SVG and oversized uploads server-side", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");

    const manifest = await (await page.request.get("/__xyle/api/manifest")).json();
    const svgForm = new FormData();
    svgForm.set(
      "metadata",
      JSON.stringify({
        baseSnapshotDigest: manifest.snapshotDigest,
        pages: [],
      }),
    );
    svgForm.set(
      "/__media/aaaaaaaaaaaa.svg",
      new File([SVG_BYTES], "evil.svg", { type: "image/svg+xml" }),
    );
    const origin = new URL(page.url()).origin;
    const res1 = await page.request.post("/__xyle/api/publish", {
      headers: { "x-xyle-request": "1", origin },
      multipart: svgForm,
    });
    expect(res1.status()).toBe(400);
    expect(await res1.text()).toMatch(/SVG|unsupported/i);

    const bigBytes = Buffer.alloc(21 * 1024 * 1024, 8);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    pngHeader.copy(bigBytes, 0);
    const bigForm = new FormData();
    bigForm.set(
      "metadata",
      JSON.stringify({ baseSnapshotDigest: manifest.snapshotDigest, pages: [] }),
    );
    bigForm.set(
      "/__media/bbbbbbbbbbbb.png",
      new File([bigBytes], "big.png", { type: "image/png" }),
    );
    const res2 = await page.request.post("/__xyle/api/publish", {
      headers: { "x-xyle-request": "1", origin },
      multipart: bigForm,
    });
    expect(res2.status()).toBe(413);
    expect(await res2.text()).toMatch(/large/i);
  });

  test("decorative images explain and apply empty alternative text", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const imgId = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return doc
        .querySelector('img[src="/assets/hero-fallback.jpg"]')
        ?.getAttribute("data-xyle-node");
    });
    expect(imgId).toBeTruthy();

    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${imgId}"]`);
    await clickNode(page, imgId!);
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" }).click();
    const toolbar = page.locator(".xyle-img-tools");
    const altInput = toolbar.locator("input[name=alt]");
    const decorative = toolbar.getByRole("checkbox", {
      name: "The page makes sense without this image",
    });
    await expect(
      toolbar.getByText(
        "Choose this for a background or visual detail. Screen readers will skip the image.",
      ),
    ).toBeVisible();
    await expect(decorative).not.toBeChecked();

    await altInput.fill("");
    await toolbar.getByRole("button", { name: "Save" }).click();
    await expect(toolbar.getByRole("alert")).toHaveText(
      "Describe the image, or confirm that the page makes sense without it.",
    );
    await decorative.check();
    await expect(altInput).toBeDisabled();
    await toolbar.getByRole("button", { name: "Save" }).click();
    await expect(image).toHaveAttribute("alt", "");
    await expect.poll(async () => opsCount(page)).toBe(1);

    await clickNode(page, imgId!);
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" }).click();
    await expect(
      page
        .locator(".xyle-img-tools")
        .getByRole("checkbox", { name: "The page makes sense without this image" }),
    ).toBeChecked();
  });

  test("alt text can be edited and publishes to source", async ({ page }, info) => {
    await loginAndOpenEditor(page, "/about.html");
    const imgId = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      for (const el of doc.querySelectorAll("img[data-xyle-node]")) {
        if ((el as HTMLImageElement).getAttribute("src") === "/misc/team.jpg") {
          return el.getAttribute("data-xyle-node");
        }
      }
      return null;
    });

    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${imgId}"]`);
    const originalAlt = (await image.getAttribute("alt")) ?? "";
    await clickNode(page, imgId!);
    const altButton = page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" });
    await expect(altButton).toBeVisible();
    await altButton.click();
    const toolbar = page.locator(".xyle-img-tools");
    await expect(toolbar.locator("input[name=alt]")).toBeVisible();
    const altText = `Crew photo, spring cleanup ${info.project.name}`;
    await toolbar.locator("input[name=alt]").fill(altText);
    await toolbar.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    const ops = await currentOps(page);
    expect(ops[0]?.op.type).toBe("media");

    await page.click("#xyle-changes");
    const change = page
      .getByRole("dialog", { name: "Changes" })
      .locator(".xyle-change-row")
      .filter({ hasText: originalAlt })
      .filter({ hasText: altText });
    await expect(change.locator(".xyle-change-before")).toContainText(originalAlt);
    await expect(change.locator(".xyle-change-after")).toContainText(altText);
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const html = await (await page.request.get("/about.html")).text();
    expect(html).toContain(`alt="${altText}"`);
    expect(html).not.toContain("unused-placeholder");
    expect(html).not.toContain("data-xyle-node");

    await page.goto("/about.html");
    const publishedImage = page.locator('img[src="/misc/team.jpg"]');
    await expect(publishedImage).toHaveAttribute("alt", altText);
    await expect(publishedImage).not.toHaveAttribute("data-xyle-node");
  });

  test("published uploads remain in the next filesystem snapshot", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    await image.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "published.png", mimeType: "image/png", buffer: PNG_BYTES });
    await expect.poll(async () => opsCount(page)).toBe(1);
    const mediaOp = (await currentOps(page)).find((entry) => entry.op.type === "media");
    const source = (mediaOp?.op as { value: MediaState } | undefined)?.value.source;
    const uploadedPath = source?.kind === "staged" ? source.assetId : "";
    expect(uploadedPath).toMatch(/^\/__media\/[0-9a-f]{64}\.png$/);

    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    expect((await page.request.get(uploadedPath)).ok()).toBe(true);
    expect((await page.request.get("/__xyle/api/manifest")).ok()).toBe(true);

    await page.goto("/index.html");
    const publishedImage = page.locator(`img[src="${uploadedPath}"]`);
    await expect(publishedImage).toHaveCount(1);
    await expect(publishedImage).toHaveAttribute("alt", "A careful repair in progress");
    await expect(publishedImage).not.toHaveAttribute("data-xyle-node");
  });

  test("publishes a derived crop without changing the original asset", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const selected = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      const images = [...doc.querySelectorAll("img[data-xyle-node]")] as HTMLImageElement[];
      const image =
        images.find((candidate) => candidate.alt === "A careful repair in progress") ?? images[0];
      return {
        id: image?.getAttribute("data-xyle-node"),
        src: image?.getAttribute("src") ?? "",
        style: image?.getAttribute("style") ?? "",
      };
    });
    expect(selected.id).toBeTruthy();
    const image = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${selected.id}"]`);
    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Crop" }).click();
    const dialog = page.locator(".xyle-inline-media-editor");
    await expect(dialog).toBeVisible();
    await dialog.locator("#xyle-zoom").fill("1.5");
    await dialog.locator("#xyle-focal-x").fill("70");
    await dialog.locator("#xyle-focal-y").fill("30");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await page.click("#xyle-publish");
    await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
    const html = await (await page.request.get("/index.html")).text();
    const targetTag =
      html.match(/<img\b(?=[^>]*alt="A careful repair in progress")[^>]*>/i)?.[0] ?? "";
    expect(targetTag).toMatch(/src="\/__media\/[0-9a-f]{64}\.webp"/);
    if (/object-fit\s*:\s*cover/i.test(selected.style)) {
      expect(targetTag).toContain("object-fit: cover");
    } else {
      expect(targetTag).not.toContain("object-fit: cover");
    }
    expect(targetTag).toContain("object-position: 70% 30%");
    expect(targetTag).not.toContain(`src="${selected.src}"`);
    const derivedPath = targetTag.match(/src="([^"]+)"/)?.[1];
    expect(derivedPath).toMatch(/^\/__media\/[0-9a-f]{64}\.webp$/);

    await page.goto("/index.html");
    const publishedImage = page.locator('img[alt="A careful repair in progress"]');
    await expect(publishedImage).toHaveAttribute("src", derivedPath!);
    await expect(publishedImage).toHaveCSS("object-position", "70% 30%");
    await expect(publishedImage).not.toHaveAttribute("data-xyle-node");
  });
});
