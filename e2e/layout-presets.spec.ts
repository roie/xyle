import { expect, test } from "@playwright/test";
import { loginAndOpenEditor } from "./helpers.ts";

test("unsupported Layout controls explain why they are disabled", async ({ page }) => {
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
  await layout.press("Enter");
  const tools = page.locator(".xyle-section-tools");
  await expect(tools).toBeVisible();
  for (const name of ["Stack", "Split", "Swap sides"]) {
    const button = tools.getByRole("button", { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute(
      "title",
      "Layout uses unsupported positioning or writing mode",
    );
  }
  await expect(page.locator("#xyle-dirty")).toBeHidden();
});

test("Outline panel unifies safe layout controls and unsupported explanations", async ({
  page,
}) => {
  await loginAndOpenEditor(page, "/layouts.html");
  await page.locator("#xyle-control-hitbox").hover();
  await page.locator("#xyle-structure-shortcut").click();
  const structure = page.getByRole("dialog", { name: "Outline" });

  const safeLayout = structure.locator(".xyle-structure-row").filter({ hasText: "Safe layout" });
  await safeLayout.getByRole("button", { name: "Select Safe layout" }).click();
  const inspector = structure.locator(".xyle-structure-inspector");
  await inspector.getByRole("button", { name: "Split" }).click();
  await expect(structure).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Split" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.frameLocator("#xyle-preview").locator("#layout-basic")).toHaveAttribute(
    "data-xyle-layout",
    "split",
  );

  const authoredLayout = structure
    .locator(".xyle-structure-row")
    .filter({ hasText: "Authored flex" });
  await authoredLayout.getByRole("button", { name: "Select Authored flex" }).click();
  await expect(inspector).toContainText("Layout uses unsupported positioning or writing mode");
  await expect(inspector.getByRole("button", { name: "Stack" })).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Split" })).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Swap sides" })).toBeDisabled();
});

test("applies and publishes the safe Split preset", async ({ page }) => {
  await loginAndOpenEditor(page, "/layouts.html");
  await page.waitForFunction(
    () =>
      (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument?.body.dataset
        .xyleWired === "true",
  );
  await page.frameLocator("#xyle-preview").locator("#layout-basic").press("Enter");
  await expect(page.locator(".xyle-layout-tools").first()).toBeVisible();
  await page.locator(".xyle-layout-tools button", { hasText: "Split" }).click();
  const preview = page.frameLocator("#xyle-preview");
  await expect(preview.locator("#layout-basic")).toHaveAttribute("data-xyle-layout", "split");
  await expect(preview.locator("#layout-basic h2")).toContainText("Safe layout");
  await page.frameLocator("#xyle-preview").locator("#layout-basic").press("Enter");
  await expect(page.locator(".xyle-layout-tools button", { hasText: "Swap sides" })).toBeEnabled();
  await page.locator(".xyle-layout-tools button", { hasText: "Swap sides" }).click();
  await expect(preview.locator("#layout-basic > div").nth(0)).toHaveClass(/layout-content/);
  await expect(preview.locator("#layout-basic > div").nth(1)).toHaveClass(/layout-image/);
  await page.frameLocator("#xyle-preview").locator("#layout-unsafe").press("Enter");
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
