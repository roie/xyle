import { expect, test } from "@playwright/test";
import {
  clickOutsideToCommit,
  editNode,
  findNodeByText,
  loginAndOpenEditor,
  setSelection,
} from "./helpers.ts";

test("golden human walkthrough covers the exposed editor contract", async ({ page }) => {
  await loginAndOpenEditor(page, "/qa-golden.html");
  const preview = page.frameLocator("#xyle-preview");

  const headingId = await findNodeByText(page, "Complete editor walkthrough");
  expect(headingId).toBeTruthy();
  await editNode(page, headingId!);
  await setSelection(page, { nodeId: headingId!, selectAll: true });
  await page.keyboard.insertText("Reliable editor walkthrough");
  await clickOutsideToCommit(page);
  await expect(preview.locator(`[data-xyle-node="${headingId}"]`)).toHaveText(
    "Reliable editor walkthrough",
  );

  await editNode(page, headingId!);
  await setSelection(page, { nodeId: headingId!, selectAll: true });
  await page.locator(".xyle-format-tools").getByRole("button", { name: "Bold" }).click();
  await clickOutsideToCommit(page);
  await expect(
    preview.locator(`[data-xyle-node="${headingId}"] strong[data-xyle-format="bold"]`),
  ).toHaveText("Reliable editor walkthrough");

  const cardTextId = await findNodeByText(page, "Fast fixture repairs.");
  expect(cardTextId).toBeTruthy();
  await editNode(page, cardTextId!);
  await setSelection(page, { nodeId: cardTextId!, selectAll: true });
  await page.keyboard.insertText("Fast fixture repairs today.");
  await clickOutsideToCommit(page);

  const link = preview.locator('main a[href="/about.html"]').first();
  const originalHref = await link.getAttribute("href");
  const linkId = await link.getAttribute("data-xyle-node");
  await link.click();
  await page.getByRole("button", { name: "Edit URL" }).click();
  await page.locator(".xyle-link-tools input[name=href]").fill("/contact.html");
  await page.locator(".xyle-link-tools").getByRole("button", { name: "Save" }).click();
  const editedLink = preview.locator(`[data-xyle-node="${linkId}"]`);
  await expect(editedLink).toHaveAttribute("href", "/contact.html");

  const image = preview.locator('img[data-xyle-node][src="/assets/hero-wide.webp"]').first();
  const imageId = await image.getAttribute("data-xyle-node");
  const replacement = await page.request
    .get("/assets/hero-wide.webp")
    .then((response) => response.body());
  await image.click();
  const replaceChooserPromise = page.waitForEvent("filechooser");
  await page.locator(".xyle-img-tools").getByRole("button", { name: "Replace" }).click();
  const replaceChooser = await replaceChooserPromise;
  await replaceChooser.setFiles({
    name: "golden-replacement.webp",
    mimeType: "image/webp",
    buffer: replacement,
  });
  await expect
    .poll(async () => preview.locator(`[data-xyle-node="${imageId}"]`).getAttribute("src"))
    .toMatch(/^blob:/);

  await page.locator(".xyle-img-tools").getByRole("button", { name: "Adjust" }).click();
  const cropEditor = page.locator(".xyle-inline-media-editor");
  await expect(cropEditor).toBeVisible();
  await cropEditor.locator("#xyle-zoom").fill("1.2");
  await cropEditor.getByText("Fine-tune position").click();
  await cropEditor.locator("#xyle-focal-x").fill("62");
  await cropEditor.locator("#xyle-focal-y").fill("38");
  await cropEditor.getByRole("button", { name: "Done" }).click();
  await expect(cropEditor).toHaveCount(0);

  await preview.locator(`[data-xyle-node="${imageId}"]`).click();
  await page.locator(".xyle-img-tools").getByRole("button", { name: "Adjust" }).click();
  const focusEditor = page.locator(".xyle-inline-media-editor");
  await expect(focusEditor).toBeVisible();
  await focusEditor.getByText("Fine-tune position").click();
  await focusEditor.locator("#xyle-focal-x").fill("58");
  await focusEditor.locator("#xyle-focal-y").fill("42");
  await focusEditor.getByRole("button", { name: "Done" }).click();
  await expect(focusEditor).toHaveCount(0);

  const items = preview.locator("[data-xyle-group-item]");
  await expect(items).toHaveCount(2);
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const outline = page.getByRole("dialog", { name: "Outline" });
  const collapsed = outline.locator(
    '.xyle-outline-disclosure:not(:disabled)[aria-expanded="false"]',
  );
  while ((await collapsed.count()) > 0) await collapsed.first().click();
  await outline.locator(".xyle-outline-group-summary").click();
  const groupInspector = outline.locator(".xyle-outline-group-inspector");
  await expect(groupInspector).toBeVisible();
  await groupInspector.getByRole("button", { name: "Duplicate item" }).first().click();
  await expect(items).toHaveCount(3);
  const moveLater = groupInspector.getByRole("button", { name: "Move later" }).first();
  await expect(moveLater).toBeDisabled();
  await expect(moveLater).toHaveAttribute("title", /unpublished items/);

  const duplicateRow = outline
    .locator(".xyle-outline-node")
    .filter({ hasText: "A section worth repeating" });
  await duplicateRow.locator(".xyle-outline-menu-trigger").click();
  await duplicateRow.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(preview.locator("main > section[data-xyle-node]")).toHaveCount(6);

  const layout = preview.locator("#qa-layout");
  const layoutRow = outline.locator(".xyle-outline-node").filter({ hasText: "Two useful regions" });
  await layoutRow.locator(".xyle-outline-select").click();
  await outline.getByRole("button", { name: "Image left" }).click();
  await expect(layout.locator("> div").first()).toHaveClass(/qa-layout-image/);

  await page.locator("#xyle-changes").click();
  const changes = page.getByRole("dialog", { name: "Changes" });
  await expect(changes).toContainText("Text");
  await expect(changes).toContainText("Formatting");
  await expect(changes).toContainText("Link");
  await expect(changes).toContainText("Image");
  await expect(changes).toContainText("Area");
  await expect(changes).toContainText("Group item");
  await expect(changes).toContainText("Layout");

  await page.locator("#xyle-changes-close").click();
  await page.keyboard.press("Control+z");
  await expect(layout.locator("> div").first()).toHaveClass(/qa-layout-copy/);
  await page.keyboard.press("Control+Shift+z");
  await expect(layout.locator("> div").first()).toHaveClass(/qa-layout-image/);

  await page.locator("#xyle-changes").click();
  const linkChange = changes.locator(".xyle-change-row").filter({ hasText: "/contact.html" });
  await linkChange.getByRole("button", { name: /Revert/ }).click();
  await expect(editedLink).toHaveAttribute("href", originalHref!);
  await expect(linkChange).toHaveCount(0);
  await page.locator("#xyle-changes-close").click();

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  const publishResult = await publishResponse;
  expect(publishResult.ok()).toBe(true);
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });

  await page.goto("/qa-golden.html");
  await expect(page.locator("h1")).toHaveText("Reliable editor walkthrough");
  await expect(page.locator('main a[href="/about.html"]')).toHaveCount(1);
  await expect(page.locator('main a[href="/contact.html"]')).toHaveCount(0);
  await expect(page.locator("main > section")).toHaveCount(6);
  await expect(page.locator("[src^='/__media/']")).toHaveCount(1);
  const publishedState = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id).filter(Boolean);
    return {
      uniqueIds: new Set(ids).size === ids.length,
      editorMarkup:
        /data-xyle-(node|format|controlled-break|generated-(tabindex|hover|editing)|group(?:-item)?)/.test(
          html,
        ) || /contenteditable|xyle-(editing|hover|show-editables)/.test(html),
    };
  });
  expect(publishedState.uniqueIds).toBe(true);
  expect(publishedState.editorMarkup).toBe(false);
});
