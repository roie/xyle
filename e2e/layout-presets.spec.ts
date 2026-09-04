import { expect, test } from "@playwright/test";
import { loginAndOpenEditor } from "./helpers.ts";

async function openOutline(page: import("@playwright/test").Page) {
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  return page.getByRole("dialog", { name: "Outline" });
}

function areaRow(outline: import("@playwright/test").Locator, name: string) {
  return outline.locator(".xyle-outline-node").filter({ hasText: name });
}

test("unsupported layout choices explain why they are unavailable", async ({ page }) => {
  await loginAndOpenEditor(page, "/layouts.html");
  await page.waitForFunction(
    () =>
      (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.body.dataset
        .xyleWired === "true",
  );
  const layout = page.frameLocator("#xyle-preview").locator("#layout-flex");
  await expect
    .poll(() => layout.evaluate((element) => getComputedStyle(element).direction))
    .toBe("rtl");

  const outline = await openOutline(page);
  await areaRow(outline, "Authored flex").locator(".xyle-outline-select").click();
  const inspector = outline.locator(".xyle-structure-inspector");
  await expect(inspector).toBeEmpty();
  await expect(outline.getByRole("button", { name: "Change layout" })).toHaveCount(0);
  await expect(page.locator("#xyle-dirty")).toBeHidden();
});

test("Outline presents safe visual layout outcomes", async ({ page }) => {
  await loginAndOpenEditor(page, "/layouts.html");
  const outline = await openOutline(page);
  await areaRow(outline, "Safe layout").locator(".xyle-outline-select").click();
  const inspector = outline.locator(".xyle-structure-inspector");
  await inspector.getByRole("button", { name: "Image left" }).click();
  await expect(outline).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Image left" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.frameLocator("#xyle-preview").locator("#layout-basic")).toHaveAttribute(
    "data-xyle-layout",
    "split",
  );

  await areaRow(outline, "Authored flex").locator(".xyle-outline-select").click();
  await expect(inspector).toBeEmpty();
});

test("mobile ChangeSet undo releases the replaced drawer focus trap", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await loginAndOpenEditor(page, "/layouts.html");
  const outline = await openOutline(page);
  await outline.getByRole("button", { name: "Text left" }).click();
  await outline.getByRole("button", { name: "Close outline" }).click();

  await page.locator("#xyle-changes").click();
  const changes = page.getByRole("dialog", { name: "Changes" });
  await changes.getByRole("button", { name: /Undo task/ }).click();
  const refreshed = page.getByRole("dialog", { name: "Changes" });
  await expect(refreshed).toHaveAttribute("data-xyle-drawer-mode", "modal");
  await expect(page.locator("#xyle-shell")).toHaveAttribute("inert", "");
  await refreshed.getByRole("button", { name: "Close changes drawer" }).click();
  await expect(page.locator("#xyle-shell")).not.toHaveAttribute("inert", "");
});

test("publishes one atomic visual layout choice", async ({ page }) => {
  await loginAndOpenEditor(page, "/layouts.html");
  const outline = await openOutline(page);
  await areaRow(outline, "Safe layout").locator(".xyle-outline-select").click();
  const inspector = outline.locator(".xyle-structure-inspector");
  await inspector.getByRole("button", { name: "Text left" }).click();

  const preview = page.frameLocator("#xyle-preview");
  await expect(preview.locator("#layout-basic")).toHaveAttribute("data-xyle-layout", "split");
  await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);
  await expect(preview.locator("#layout-basic > div").nth(1)).toHaveClass(/layout-image/);
  await expect(page.locator("#xyle-count")).toHaveText("2");
  await page.keyboard.press("Control+z");
  await expect(preview.locator("#layout-basic")).not.toHaveAttribute("data-xyle-layout");
  await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-image/);
  await page.keyboard.press("Control+Shift+z");
  await expect(preview.locator("#layout-basic")).toHaveAttribute("data-xyle-layout", "split");
  await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  const published = await page.request.get("/layouts.html");
  const publishedHtml = await published.text();
  expect(publishedHtml.indexOf('class="layout-content"')).toBeLessThan(
    publishedHtml.indexOf('class="layout-image"'),
  );
  expect(publishedHtml).toContain('data-xyle-layout="split"');
  const assetHref = publishedHtml.match(/href="([^"]+)" data-xyle-resource="layout-v1"/)?.[1];
  expect(assetHref).toBeTruthy();
  const cssResponse = await page.request.get(assetHref!);
  expect(cssResponse.ok()).toBe(true);
  expect(await cssResponse.text()).toContain('[data-xyle-layout="split"]');
  await page.goto("/layouts.html");
  await expect(page.locator("#layout-basic")).toBeVisible();
  await expect(page.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);
  await expect(page.locator("#layout-basic > div").nth(1)).toHaveClass(/layout-image/);
  await expect(page.locator('link[data-xyle-resource="layout-v1"]')).toHaveCount(1);
});
