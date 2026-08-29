import { expect, test } from "@playwright/test";
import { loginAndOpenEditor, opsCount } from "./helpers.ts";

async function openSectionTools(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  const section = page.frameLocator("#xyle-preview").locator(selector);
  await section.press("Enter");
  await expect(page.locator(".xyle-section-tools")).toBeVisible();
}

test.describe("canonical net reconciliation", () => {
  test("unchanged and restored link destinations stay clean", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const link = page.frameLocator("#xyle-preview").locator("a.cta");
    const original = await link.getAttribute("href");

    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    const panel = page.locator(".xyle-link-tools");
    await panel.locator("input[name=href]").fill(original ?? "");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);

    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    await page.locator(".xyle-link-tools input[name=href]").fill("/services.html");
    await page.locator(".xyle-link-tools").getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);

    await link.click();
    await page.getByRole("button", { name: "Edit URL" }).click();
    await page.locator(".xyle-link-tools input[name=href]").fill(original ?? "");
    await page.locator(".xyle-link-tools").getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("layout and region order restore to the authored baseline", async ({ page }) => {
    await loginAndOpenEditor(page, "/layouts.html");
    const section = page.frameLocator("#xyle-preview").locator("#layout-basic");

    await openSectionTools(page, "#layout-basic");
    await page.locator(".xyle-layout-tools").getByRole("button", { name: "Stack" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);

    await openSectionTools(page, "#layout-basic");
    await page.locator(".xyle-layout-tools").getByRole("button", { name: "Split" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(section).toHaveAttribute("data-xyle-layout", "split");

    await openSectionTools(page, "#layout-basic");
    await page.locator(".xyle-layout-tools").getByRole("button", { name: "Stack" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(section).not.toHaveAttribute("data-xyle-layout", "split");

    await openSectionTools(page, "#layout-basic");
    await page.locator(".xyle-layout-tools").getByRole("button", { name: "Swap order" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await openSectionTools(page, "#layout-basic");
    await page.locator(".xyle-layout-tools").getByRole("button", { name: "Swap order" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
  });
});
