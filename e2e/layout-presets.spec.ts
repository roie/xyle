import { expect, test } from "@playwright/test";
import { loginAndOpenEditor } from "./helpers.ts";

test("applies and publishes the safe Split preset", async ({ page }) => {
  await loginAndOpenEditor(page, "/layouts.html");
  await page.waitForFunction(
    () =>
      (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.body.dataset
        .xyleWired === "true",
  );
  await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    const section = doc.querySelector("#layout-basic")!;
    section.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await expect(page.locator(".xyle-layout-tools").first()).toBeVisible();
  await page.locator(".xyle-layout-tools button", { hasText: "Split" }).click({ force: true });
  const preview = page.frameLocator("#xyle-preview");
  await expect(preview.locator("#layout-basic")).toHaveAttribute("data-xyle-layout", "split");
  await expect(preview.locator("#layout-basic h2")).toContainText("Safe layout");
  await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    doc
      .querySelector("#layout-basic")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await expect(page.locator(".xyle-layout-tools button", { hasText: "Swap order" })).toBeEnabled();
  await page.locator(".xyle-layout-tools button", { hasText: "Swap order" }).click({ force: true });
  await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);
  await expect(preview.locator("#layout-basic > div").nth(1)).toHaveClass(/layout-image/);
  await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    doc
      .querySelector("#layout-unsafe")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await expect(page.locator(".xyle-layout-tools")).toHaveCount(0);
  await expect(preview.locator("#layout-unsafe")).not.toHaveAttribute("data-xyle-layout");
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
