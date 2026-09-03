import { expect, test } from "@playwright/test";
import {
  editNode,
  findNodeByText,
  loginAndOpenEditor,
  nodeHtml,
  opsCount,
  setSelection,
} from "./helpers.ts";

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

  test("section visibility and order restore to the authored baseline", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const sectionIds = await page.evaluate(() => {
      const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
      return [...doc.querySelectorAll("main > section[data-xyle-node]")].map((section) =>
        section.getAttribute("data-xyle-node"),
      );
    });
    expect(sectionIds.length).toBeGreaterThanOrEqual(2);
    const first = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${sectionIds[0]}"]`);

    await first.press("Enter");
    await page.getByRole("button", { name: "Move down" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await first.press("Enter");
    await page.getByRole("button", { name: "Move up" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement)
            .contentDocument!;
          return [...doc.querySelectorAll("main > section[data-xyle-node]")].map((section) =>
            section.getAttribute("data-xyle-node"),
          );
        }),
      )
      .toEqual(sectionIds);

    await first.press("Enter");
    await page.getByRole("button", { name: "Hide section" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(first).toHaveJSProperty("hidden", true);
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-menu-btn").click();
    await page.getByRole("menuitem", { name: "Sections" }).click();
    const sections = page.getByRole("dialog", { name: "Sections" });
    await sections.getByRole("button", { name: "Show" }).first().click();

    await expect(first).toHaveJSProperty("hidden", false);
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("human formatting restores to the authored baseline", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const nodeId = await findNodeByText(page, "Edit your static site visually");
    expect(nodeId).toBeTruthy();
    const originalHtml = await nodeHtml(page, nodeId!);
    const target = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${nodeId}"]`);

    await editNode(page, nodeId!);
    await setSelection(page, { nodeId: nodeId!, selectAll: true });
    const bold = page.locator(".xyle-format-tools").getByRole("button", { name: "Bold" });
    await bold.click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(target.locator('strong[data-xyle-format="bold"]')).toHaveCount(1);

    await editNode(page, nodeId!);
    await setSelection(page, { nodeId: nodeId!, selectAll: true });
    await page.locator(".xyle-format-tools").getByRole("button", { name: "Bold" }).click();

    await expect(target.locator('strong[data-xyle-format="bold"]')).toHaveCount(0);
    expect(await nodeHtml(page, nodeId!)).toBe(originalHtml);
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("media alt text restores to the authored baseline", async ({ page }) => {
    await loginAndOpenEditor(page, "/about.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/misc/team.jpg"]');
    const originalAlt = (await image.getAttribute("alt")) ?? "";

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" }).click();
    await page.locator('.xyle-img-tools input[name="alt"]').fill("Temporary description");
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" }).click();
    await page.locator('.xyle-img-tools input[name="alt"]').fill(originalAlt);
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Save" }).click();

    await expect(image).toHaveAttribute("alt", originalAlt);
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
