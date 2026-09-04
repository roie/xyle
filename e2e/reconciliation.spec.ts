import { expect, test } from "@playwright/test";
import {
  editNode,
  findNodeByText,
  loginAndOpenEditor,
  nodeHtml,
  opsCount,
  setSelection,
} from "./helpers.ts";

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
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-structure-shortcut").click();
    const structure = page.getByRole("dialog", { name: "Outline" });
    const firstRow = structure.locator(`.xyle-outline-node[data-section-id="${sectionIds[0]}"]`);
    await firstRow.locator(".xyle-outline-select").click();

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await firstRow.getByRole("button", { name: "Move down", exact: true }).click();
      await expect.poll(async () => opsCount(page)).toBe(1);
      await firstRow.getByRole("button", { name: "Move up", exact: true }).click();
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
    }

    await firstRow.locator(".xyle-outline-menu-trigger").click();
    await firstRow.getByRole("menuitem", { name: "Hide", exact: true }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(first).toHaveJSProperty("hidden", true);
    await firstRow.locator(".xyle-outline-menu-trigger").click();
    await firstRow.getByRole("menuitem", { name: "Show", exact: true }).click();

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

  test("media source restores to the authored baseline", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    const nodeId = await image.getAttribute("data-xyle-node");
    const original = await image.evaluate((element) => ({
      src: element.getAttribute("src"),
      alt: element.getAttribute("alt"),
      style: element.getAttribute("style"),
    }));

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Media" }).click();
    await page
      .getByRole("dialog", { name: "Media" })
      .getByRole("button", { name: "Choose /assets/hero-fallback.jpg" })
      .click();
    await expect
      .poll(() =>
        page
          .frameLocator("#xyle-preview")
          .locator(`[data-xyle-node="${nodeId}"]`)
          .getAttribute("src"),
      )
      .toBe("/assets/hero-fallback.jpg");
    expect(await opsCount(page)).toBe(1);

    const changedImage = page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${nodeId}"]`);
    await changedImage.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Media" }).click();
    await page
      .getByRole("dialog", { name: "Media" })
      .getByRole("button", { name: "Choose /assets/hero-wide.webp" })
      .click();

    await expect(changedImage).toHaveAttribute("src", original.src!);
    await expect(changedImage).toHaveAttribute("alt", original.alt!);
    expect(await changedImage.getAttribute("style")).toBe(original.style);
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("media Reset restores authored crop focus and fit state", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const image = page
      .frameLocator("#xyle-preview")
      .locator('img[data-xyle-node][src="/assets/hero-wide.webp"]');
    const original = await image.evaluate((element) => ({
      src: element.getAttribute("src"),
      alt: element.getAttribute("alt"),
      style: (element as HTMLElement).style.cssText,
    }));

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Adjust" }).click();
    let dialog = page.getByRole("dialog", { name: "Adjust image" });
    await dialog.locator("select[name=fit]").selectOption("contain");
    await dialog.locator("#xyle-zoom").fill("1.8");
    await dialog.getByText("Fine-tune position").click();
    await dialog.locator("#xyle-focal-x").fill("21");
    await dialog.locator("#xyle-focal-y").fill("79");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Adjust" }).click();
    dialog = page.getByRole("dialog", { name: "Adjust image" });
    await dialog.getByRole("button", { name: "Reset" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(image).toHaveAttribute("src", original.src!);
    await expect(image).toHaveAttribute("alt", original.alt!);
    expect(await image.evaluate((element) => (element as HTMLElement).style.cssText)).toBe(
      original.style,
    );
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(page.locator("#xyle-dirty")).toBeHidden();
  });

  test("Revert restores authored missing-alt presence", async ({ page }) => {
    await loginAndOpenEditor(page, "/media-missing-alt.html");
    const image = page.frameLocator("#xyle-preview").locator('img[src="/misc/team.jpg"]');
    await expect(image).not.toHaveAttribute("alt");

    await image.click();
    await page.locator(".xyle-img-tools").getByRole("button", { name: "Alt" }).click();
    const tools = page.locator(".xyle-img-tools");
    await tools.locator("input[name=alt]").fill("A team reviewing the site");
    await tools.getByRole("button", { name: "Save" }).click();
    await expect(image).toHaveAttribute("alt", "A team reviewing the site");
    await expect.poll(async () => opsCount(page)).toBe(1);

    await page.locator("#xyle-changes").click();
    const change = page
      .getByRole("dialog", { name: "Changes" })
      .locator(".xyle-change-row")
      .filter({ hasText: "A team reviewing the site" });
    await expect(change).toHaveCount(1);
    await change.getByRole("button", { name: /Revert/ }).click();

    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(image).not.toHaveAttribute("alt");
    await expect(page.locator("#xyle-dirty")).toBeHidden();
    await page.getByRole("button", { name: "Close changes drawer" }).click();

    await page.keyboard.press("Control+z");
    await expect(image).toHaveAttribute("alt", "A team reviewing the site");
    await expect.poll(async () => opsCount(page)).toBe(1);
    await page.keyboard.press("Control+Shift+z");
    await expect(image).not.toHaveAttribute("alt");
    await expect.poll(async () => opsCount(page)).toBe(0);
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
    await page.locator("#xyle-control-hitbox").hover();
    await page.locator("#xyle-structure-shortcut").click();
    const outline = page.getByRole("dialog", { name: "Outline" });
    const safeLayout = outline.locator(".xyle-outline-node").filter({ hasText: "Safe layout" });
    await safeLayout.locator(".xyle-outline-select").click();

    await outline.getByRole("button", { name: "Above and below" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);

    await outline.getByRole("button", { name: "Image left" }).click();
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(section).toHaveAttribute("data-xyle-layout", "split");

    await outline.getByRole("button", { name: "Above and below" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
    await expect(section).not.toHaveAttribute("data-xyle-layout", "split");

    await outline.getByRole("button", { name: "Text left" }).click();
    await expect.poll(async () => opsCount(page)).toBe(2);
    await outline.getByRole("button", { name: "Above and below" }).click();
    await expect.poll(async () => opsCount(page)).toBe(0);
  });
});
