import { expect, test } from "@playwright/test";
import { clickOutsideToCommit, editNode, loginAndOpenEditor, setSelection } from "./helpers.ts";

test("discovers and duplicates a source-backed Group item through the human UI", async ({
  page,
}) => {
  await loginAndOpenEditor(page, "/groups.html");
  const preview = page.frameLocator("#xyle-preview");
  const group = preview.locator("[data-xyle-group]");
  const items = preview.locator("[data-xyle-group-item]");
  await expect(group).toHaveCount(1);
  await expect(items).toHaveCount(2);

  const firstItemId = await items.first().getAttribute("data-xyle-group-item");
  expect(firstItemId).toBeTruthy();
  await items.first().focus();
  await expect(page.locator(".xyle-group-item-tools")).toBeVisible();
  await page
    .locator(".xyle-group-item-tools button", { hasText: "Duplicate item" })
    .click({ force: true });
  await expect(items).toHaveCount(3, { timeout: 10_000 });

  const createdId = await page.evaluate((sourceId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll<HTMLElement>("[data-xyle-group-item]")]
      .map((item) => item.dataset.xyleGroupItem)
      .find((id) => id && id !== sourceId);
  }, firstItemId);
  expect(createdId).toMatch(/^x-[a-f0-9]{8}$/);

  const originalTitleId = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc
      .querySelector<HTMLElement>("[data-xyle-group-item]")
      ?.querySelector<HTMLElement>("h2[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  });
  const titleId = await page.evaluate((itemId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc
      .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
      ?.querySelector<HTMLElement>("h2[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  }, createdId);
  expect(titleId).toBeTruthy();
  const title = preview.locator(`[data-xyle-node="${titleId}"]`);
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Duplicated service");
  await clickOutsideToCommit(page);
  await expect(title).toContainText("Duplicated service");
  expect(originalTitleId).toBeTruthy();
  await editNode(page, originalTitleId!);
  await setSelection(page, { nodeId: originalTitleId!, selectAll: true });
  await page.keyboard.insertText("Original service");
  await clickOutsideToCommit(page);
  await expect(preview.locator(`[data-xyle-node="${originalTitleId}"]`)).toContainText(
    "Original service",
  );

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  await page.goto("/groups.html");
  await expect(page.locator("article")).toHaveCount(3);
  await expect(page.getByText("Duplicated service")).toHaveCount(1);
  await expect(page.getByText("Original service")).toHaveCount(1);
  expect(await page.locator("[data-xyle-node]").count()).toBe(0);
});
