import { expect, test } from "@playwright/test";
import {
  clickOutsideToCommit,
  editNode,
  findNodeByText,
  loginAndOpenEditor,
  setSelection,
} from "./helpers.ts";

async function sectionState(
  page: import("@playwright/test").Page,
): Promise<Array<{ id: string; text: string; src: string; fit: string; position: string }>> {
  return page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll("main > section.work-standard[data-xyle-node]")].map(
      (section) => {
        const image = section.querySelector("img") as HTMLImageElement | null;
        return {
          id: section.getAttribute("data-xyle-node") ?? "",
          text: section.textContent ?? "",
          src: image?.getAttribute("src") ?? "",
          fit: image?.style.objectFit ?? "",
          position: image?.style.objectPosition ?? "",
        };
      },
    );
  });
}

async function editText(
  page: import("@playwright/test").Page,
  id: string,
  value: string,
): Promise<void> {
  await editNode(page, id);
  await setSelection(page, { nodeId: id, selectAll: true });
  await page.keyboard.insertText(value);
  await clickOutsideToCommit(page);
}

async function cropImage(
  page: import("@playwright/test").Page,
  image: import("@playwright/test").Locator,
  x: string,
  y: string,
): Promise<void> {
  await image.click();
  await page.locator(".xyle-img-tools").getByRole("button", { name: "Adjust" }).click();
  const dialog = page.locator(".xyle-inline-media-editor");
  await expect(dialog).toBeVisible();
  await dialog.locator("select[name=fit]").selectOption("cover");
  await dialog.getByText("Fine-tune position").click();
  await dialog.locator("#xyle-focal-x").fill(x);
  await dialog.locator("#xyle-focal-y").fill(y);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

test("duplicates a safe section through its complete independent lifecycle", async ({ page }) => {
  await loginAndOpenEditor(page, "/index.html");

  const originalHeading = await findNodeByText(page, "No hidden content model.");
  expect(originalHeading).toBeTruthy();
  await editText(page, originalHeading!, "Original before duplication");
  await editNode(page, originalHeading!);
  await setSelection(page, { nodeId: originalHeading!, selectAll: true });
  await page
    .locator('.xyle-format-tools select[aria-label="Block style"]')
    .selectOption("heading-3");

  const originalImage = page
    .frameLocator("#xyle-preview")
    .locator("section.work-standard[data-xyle-node] img")
    .first();
  await cropImage(page, originalImage, "22", "65");

  const sourceSection = page
    .frameLocator("#xyle-preview")
    .locator("main > section.work-standard[data-xyle-node]")
    .first();
  await sourceSection.press("Enter");
  await page.getByRole("button", { name: "Duplicate section" }).click();

  await expect.poll(async () => (await sectionState(page)).length).toBe(2);
  const afterDuplicate = await sectionState(page);
  expect(afterDuplicate[1]!.text).toContain("Original before duplication");
  expect(afterDuplicate[1]!.fit).toBe("cover");
  expect(afterDuplicate[1]!.position).toBe("22% 65%");

  const createdSection = page
    .frameLocator("#xyle-preview")
    .locator("main > section.work-standard[data-xyle-node]")
    .nth(1);
  await createdSection.press("Enter");
  const duplicateAgain = page.getByRole("button", { name: "Duplicate section", exact: true });
  await expect(duplicateAgain).toBeDisabled();
  await expect(duplicateAgain).toHaveAttribute(
    "title",
    "Publish this section before duplicating it again",
  );

  const duplicateHeading = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll("main > section.work-standard[data-xyle-node]")][1]
      ?.querySelector("h1[data-xyle-node],h2[data-xyle-node],h3[data-xyle-node],h4[data-xyle-node],h5[data-xyle-node],h6[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  });
  const duplicateImage = page
    .frameLocator("#xyle-preview")
    .locator("section.work-standard[data-xyle-node]")
    .nth(1)
    .locator("img");
  expect(duplicateHeading).toBeTruthy();
  for (const format of ["paragraph", "heading-3"]) {
    await editNode(page, originalHeading!);
    await setSelection(page, { nodeId: originalHeading!, selectAll: true });
    await page.locator('.xyle-format-tools select[aria-label="Block style"]').selectOption(format);
  }
  await expect(
    page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${originalHeading}"]`),
  ).toHaveJSProperty("tagName", "H3");

  await editNode(page, duplicateHeading!);
  await setSelection(page, { nodeId: duplicateHeading!, selectAll: true });
  await page
    .locator('.xyle-format-tools select[aria-label="Block style"]')
    .selectOption("heading-4");
  await expect(
    page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${duplicateHeading}"]`),
  ).toHaveJSProperty("tagName", "H4");
  await editText(page, duplicateHeading!, "Duplicate final heading");
  await cropImage(page, duplicateImage, "78", "31");
  await editText(page, originalHeading!, "Original final heading");

  const independent = await sectionState(page);
  expect(independent[0]!.text).toContain("Original final heading");
  expect(independent[1]!.text).toContain("Duplicate final heading");
  expect(independent[0]!.position).toBe("22% 65%");
  expect(independent[1]!.position).toBe("78% 31%");

  const orderBeforeMove = independent.map((section) => section.id);
  await sourceSection.press("Enter");
  await page.getByRole("button", { name: "Move down" }).click();
  await expect
    .poll(async () => (await sectionState(page)).map((section) => section.id))
    .toEqual([orderBeforeMove[1], orderBeforeMove[0]]);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await sectionState(page)).map((section) => section.id))
    .toEqual(orderBeforeMove);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => (await sectionState(page)).map((section) => section.id))
    .toEqual([orderBeforeMove[1], orderBeforeMove[0]]);

  await page.locator("#xyle-changes").click();
  const duplicateChange = page.locator('.xyle-change-row[aria-label*="Duplicate section"]');
  await expect(duplicateChange).toBeVisible();
  await duplicateChange.getByRole("button", { name: /Revert Duplicate section change/ }).click();
  await expect.poll(async () => (await sectionState(page)).length).toBe(1);
  await page.locator("#xyle-changes-close").click();
  await page.locator("#xyle-changes").click();
  await expect(page.locator('.xyle-change-row[aria-label*="Duplicate section"]')).toHaveCount(0);
  await page.locator("#xyle-changes-close").click();

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sectionState(page)).length).toBe(2);
  await expect
    .poll(async () => (await sectionState(page))[1]!.text)
    .toContain("Duplicate final heading");

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  const publishResult = await publishResponse;
  expect(publishResult.ok()).toBe(true);
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  await page.goto("/index.html");
  const published = await page.evaluate(() => {
    const sections = [...document.querySelectorAll("main > section.work-standard")];
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id).filter(Boolean);
    const images = sections.map(
      (section) => section.querySelector("img") as HTMLImageElement | null,
    );
    return {
      sectionCount: sections.length,
      texts: sections.map((section) => section.textContent ?? ""),
      sources: images.map((image) => image?.getAttribute("src") ?? ""),
      styles: images.map((image) => ({
        fit: image?.style.objectFit ?? "",
        position: image?.style.objectPosition ?? "",
      })),
      references: sections.map((section) => {
        const heading = section.querySelector<HTMLElement>(
          "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
        );
        return {
          reference: section.getAttribute("aria-labelledby") ?? "",
          heading: heading?.id ?? "",
          tag: heading?.tagName ?? "",
        };
      }),
      uniqueIds: new Set(ids).size === ids.length,
      hasEditorMarkup: /data-xyle-|xyle-(editing|hover|show-editables)/.test(
        document.documentElement.outerHTML,
      ),
      hasGeneratedAccessibility:
        document.querySelector(
          '[aria-description^="Editable "],[aria-keyshortcuts*="ArrowDown"]',
        ) !== null,
    };
  });
  expect(published.sectionCount).toBe(2);
  expect(published.texts[0]).toContain("Duplicate final heading");
  expect(published.texts[1]).toContain("Original final heading");
  expect(published.sources.every((source) => source.startsWith("/__media/"))).toBe(true);
  expect(published.sources[0]).not.toBe(published.sources[1]);
  expect(published.styles).toEqual([
    { fit: "cover", position: "78% 31%" },
    { fit: "cover", position: "22% 65%" },
  ]);
  expect(published.references[0]!.reference).toBe(published.references[0]!.heading);
  expect(published.references[1]!.reference).toBe(published.references[1]!.heading);
  expect(published.references.map((reference) => reference.tag)).toEqual(["H4", "H3"]);
  expect(published.references[0]!.reference).not.toBe(published.references[1]!.reference);
  expect(published.uniqueIds).toBe(true);
  expect(published.hasEditorMarkup).toBe(false);
  expect(published.hasGeneratedAccessibility).toBe(false);

  await loginAndOpenEditor(page, "/index.html", { resetFixture: false });
  await expect(page.locator("#xyle-dirty")).toBeHidden();
  expect(await sectionState(page)).toHaveLength(2);
});
